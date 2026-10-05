import { CustomerLevel, CustomerStatus, CustomerType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildCustomerWhereClause,
  canSeeAllData,
  isSuperAdmin,
  matchesTerritory,
  type SessionUser,
} from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { canAccessCrmData } from "@/modules/crm/permissions";
import { parseLocalDate } from "@/modules/crm/dashboard/kpi-linkage";
import { DomainError } from "@/modules/shared/domain-error";

type CustomerInput = Record<string, unknown>;

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function parseLocalDateFilter(value: string) {
  const date = parseLocalDate(value);
  if (!date) throw new DomainError("创建日期筛选格式错误", 400);
  return date;
}

async function ensureActiveAssignee(assignedUserId: string | null | undefined) {
  if (!assignedUserId) return null;
  const assignee = await prisma.user.findFirst({
    where: { id: assignedUserId, isActive: true },
    select: { id: true },
  });
  if (!assignee) throw new DomainError("归属业务员不存在或已禁用");
  return assignee.id;
}

/**
 * 所有 CRM 客户列表入口共用的读服务。浏览器筛选只附加在既有权限 where 上。
 */
export async function listCustomers(user: SessionUser, searchParams: URLSearchParams) {
  if (!canAccessCrmData(user)) throw new DomainError("无权限访问 CRM", 403);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));
  const search = searchParams.get("search") || "";
  const region = searchParams.get("region") || "";
  const status = searchParams.get("status") || "";
  const level = searchParams.get("level") || "";
  const tag = searchParams.get("tag") || "";
  const assignedUserId = searchParams.get("assignedUserId") || "";
  const kpiSalesUserId = searchParams.get("kpiSalesUserId") || "";
  const createdStart = searchParams.get("createdStart") || "";
  const createdEnd = searchParams.get("createdEnd") || "";
  const where: Prisma.CustomerWhereInput = buildCustomerWhereClause(user);

  const andConditions: Prisma.CustomerWhereInput[] = [];
  if (search) {
    andConditions.push({
      OR: [
        { companyName: { contains: search } },
        { contactName: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
      ],
    });
  }
  if (andConditions.length) where.AND = andConditions;

  const province = searchParams.get("province") || "";
  const city = searchParams.get("city") || "";
  const businessLine = searchParams.get("businessLine") || "";
  if (province) where.province = province;
  if (city) where.city = city;
  if (businessLine && canSeeAllData(user)) where.businessLine = businessLine;
  if (region && isSuperAdmin(user)) where.region = region;
  if (status) where.status = status as Prisma.EnumCustomerStatusFilter;
  if (level) where.customerLevel = level as Prisma.EnumCustomerLevelFilter;
  if (kpiSalesUserId) {
    if (canSeeAllData(user) || kpiSalesUserId === user.id) where.assignedUserId = kpiSalesUserId;
    else where.id = "__NO_ACCESS__";
  } else if (assignedUserId) where.assignedUserId = assignedUserId;
  if (tag) where.interestTags = { path: "$", array_contains: tag };
  if (createdStart || createdEnd) {
    where.createdAt = {};
    if (createdStart) where.createdAt.gte = parseLocalDateFilter(createdStart);
    if (createdEnd) {
      const endExclusive = parseLocalDateFilter(createdEnd);
      endExclusive.setDate(endExclusive.getDate() + 1);
      where.createdAt.lt = endExclusive;
    }
  }

  const skip = (page - 1) * pageSize;
  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        assignedUser: { select: { id: true, name: true, email: true, isActive: true } },
        contracts: {
          where: { deletedAt: null },
          select: { id: true, amount: true, paidAmount: true, unpaidAmount: true, paymentStatus: true, contractStatus: true },
        },
        _count: { select: { contracts: true, customerQuotes: true, followRecords: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.customer.count({ where }),
  ]);

  return { customers, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

/** 保留既有客户创建校验、权限范围和审计行为的写服务。 */
export async function createCustomer(user: SessionUser, body: CustomerInput) {
  if (!canAccessCrmData(user)) throw new DomainError("无权限访问 CRM", 403);
  const seeAll = canSeeAllData(user);
  const businessLine = seeAll && body.businessLine === "外贸" ? "外贸" : "国内销售";
  const province = cleanText(body.province);
  const city = cleanText(body.city);
  if (!body.companyName || !body.contactName || !province || !body.customerSource || !body.customerType || !body.customerLevel) {
    throw new DomainError("公司名称、联系人、省份、客户来源、客户类型和客户等级为必填项");
  }
  if (!seeAll && !matchesTerritory(user.territories, province, city)) {
    throw new DomainError("只能在自己负责的省/市范围内新建客户,请确认省/市选择", 403);
  }

  const companyName = String(body.companyName).trim();
  const contactName = String(body.contactName).trim();
  const phone = cleanText(body.phone);
  const email = cleanText(body.email);
  const whatsapp = cleanText(body.whatsapp);
  const duplicateConditions: Prisma.CustomerWhereInput[] = [];
  if (phone) duplicateConditions.push({ phone, deletedAt: null });
  if (email) duplicateConditions.push({ email, deletedAt: null });
  if (whatsapp) duplicateConditions.push({ whatsapp, deletedAt: null });
  if (companyName) duplicateConditions.push({ companyName, deletedAt: null });
  if (duplicateConditions.length) {
    const existing = await prisma.customer.findFirst({
      where: { OR: duplicateConditions },
      select: { id: true, companyName: true, contactName: true, phone: true },
    });
    if (existing && !body._forceCreate) {
      throw new DomainError(
        `系统发现可能重复客户：${existing.companyName}（${existing.contactName}），请确认是否继续保存。`,
        409,
        { duplicate: existing }
      );
    }
  }

  const requestedAssigneeId = cleanText(body.assignedUserId);
  if (!isSuperAdmin(user) && requestedAssigneeId && requestedAssigneeId !== user.id) {
    throw new DomainError("普通销售不能将客户分配给其他负责人", 403);
  }

  const defaultAssigneeId = isSuperAdmin(user) ? null : user.id;
  const assignedUserId = await ensureActiveAssignee(requestedAssigneeId || defaultAssigneeId);
  return prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        companyName,
        contactName,
        phone,
        wechat: cleanText(body.wechat),
        whatsapp,
        email,
        country: cleanText(body.country) || "中国",
        province,
        city,
        region: cleanText(body.region) || "",
        businessLine,
        address: cleanText(body.address),
        customerSource: String(body.customerSource),
        customerType: String(body.customerType) as CustomerType,
        customerLevel: String(body.customerLevel) as CustomerLevel,
        status: String(body.status || "NEW_LEAD") as CustomerStatus,
        interestTags: Array.isArray(body.interestTags) ? body.interestTags : [],
        assignedUserId,
        remark: cleanText(body.remark),
        nextFollowDate: body.nextFollowDate ? new Date(String(body.nextFollowDate)) : null,
      },
    });
    await writeOperationLog(tx, { userId: user.id, action: "CREATE_CUSTOMER", entityType: "Customer", entityId: created.id, afterData: created });
    return created;
  });
}

export function isDuplicateCustomerError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
