import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, canSeeAllData, customerIsolationWhere } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import {
  afterSalesListWhere,
  afterSalesOrderInclude,
  afterSalesOrderPayload,
  assertAfterSalesAccess,
  assertOrderType,
  assertStatus,
  assertUrgency,
  dateOnly,
  isPrismaUniqueError,
  nextAfterSalesOrderNo,
  optionalText,
} from "@/lib/after-sales-service";
import { afterSalesOrderAlertState, afterSalesOrderIsOverdue, normalizeAfterSalesReminderConfig } from "@/lib/after-sales";

function pageNumber(value: string | null, fallback: number, max: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, max) : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    assertAfterSalesAccess(user);
    const params = request.nextUrl.searchParams;
    const status = params.get("status") ? assertStatus(params.get("status")) : undefined;
    const orderType = params.get("orderType") ? assertOrderType(params.get("orderType")) : undefined;
    const urgency = params.get("urgency") ? assertUrgency(params.get("urgency")) : undefined;
    const dateFrom = dateOnly(params.get("dateFrom"), "开始日期", false);
    const dateTo = dateOnly(params.get("dateTo"), "结束日期", false);
    const page = pageNumber(params.get("page"), 1, 100000);
    const pageSize = pageNumber(params.get("pageSize"), 20, 100);
    const where = afterSalesListWhere(user, {
      status, orderType, urgency, dateFrom, dateTo,
      equipmentModel: optionalText(params.get("equipmentModel"), "机型") ?? undefined,
      assigneeName: optionalText(params.get("assigneeName"), "售后人员") ?? undefined,
      keyword: optionalText(params.get("keyword"), "关键词") ?? undefined,
    });
    const reminder = params.get("reminder") || "";
    if (reminder === "in-progress") where.status = { in: ["PENDING_DISPATCH", "DISPATCHED", "IN_PROGRESS"] };
    if (reminder === "completed-unclosed") {
      const completed = await prisma.afterSalesOrder.findMany({ where: { ...where, status: "COMPLETED" }, select: { id: true } });
      const attachments = completed.length ? await prisma.erpAttachment.findMany({ where: { entityType: "AFTER_SALES_ORDER", entityId: { in: completed.map((item) => item.id) }, deletedAt: null }, select: { entityId: true } }) : [];
      const signedIds = new Set(attachments.map((attachment) => attachment.entityId));
      where.status = "COMPLETED"; where.id = { in: completed.map((item) => item.id).filter((id) => !signedIds.has(id)) };
    }
    if (reminder === "overdue") {
      const [setting, candidates] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: "reminders" }, select: { value: true } }),
        prisma.afterSalesOrder.findMany({ where: { ...where, status: { notIn: ["COMPLETED", "CLOSED"] } }, select: { id: true, dispatchDate: true, orderType: true, urgency: true, status: true } }),
      ]);
      const alertDays = normalizeAfterSalesReminderConfig(setting?.value).afterSalesAlertDays;
      where.id = { in: candidates.filter((item) => afterSalesOrderIsOverdue(item as any, new Date(), alertDays)).map((item) => item.id) };
    }
    const [items, total, reminderSetting] = await Promise.all([
      prisma.afterSalesOrder.findMany({ where, include: afterSalesOrderInclude, orderBy: [{ urgency: "desc" }, { dispatchDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.afterSalesOrder.count({ where }),
      prisma.systemSetting.findUnique({ where: { key: "reminders" }, select: { value: true } }),
    ]);
    const alertDays = normalizeAfterSalesReminderConfig(reminderSetting?.value).afterSalesAlertDays;
    return NextResponse.json({ items: items.map((item) => ({ ...item, alertState: afterSalesOrderAlertState(item as any, new Date(), alertDays) })), total, page, pageSize });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "售后工单加载失败" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    assertAfterSalesAccess(user);
    const body = await request.json() as Record<string, unknown>;
    const contractId = String(body.contractId || "").trim();
    if (!contractId) throw new Error("合同必选");
    const payload = afterSalesOrderPayload(body);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const created = await prisma.$transaction(async (tx) => {
          const contract = await tx.contract.findFirst({
            where: { id: contractId, deletedAt: null, customer: canSeeAllData(user) ? {} : customerIsolationWhere(user) },
            select: {
              id: true, contractNo: true, customerId: true, equipmentModel: true,
              customer: { select: { companyName: true } },
            },
          });
          if (!contract) throw new Error("合同不存在或无权访问");
          const orderNo = await nextAfterSalesOrderNo(tx);
          const row = await tx.afterSalesOrder.create({
            data: {
              orderNo,
              contractId: contract.id,
              customerId: contract.customerId,
              contractNoSnapshot: contract.contractNo,
              customerNameSnapshot: contract.customer.companyName,
              equipmentModelSnapshot: contract.equipmentModel,
              orderType: payload.orderType,
              urgency: payload.urgency,
              dispatchDate: payload.dispatchDate,
              serviceAmount: payload.serviceAmount,
              assigneeNames: payload.assigneeNames,
              serviceAddress: payload.serviceAddress,
              description: payload.description,
              createdById: user.id,
              parts: { create: payload.partNames.map((partName, sortOrder) => ({ partName, sortOrder })) },
            },
            include: afterSalesOrderInclude,
          });
          await writeOperationLog(tx, { userId: user.id, action: "CREATE_AFTER_SALES_ORDER", entityType: "AfterSalesOrder", entityId: row.id, afterData: row });
          return row;
        });
        return NextResponse.json(created, { status: 201 });
      } catch (error) {
        if (!isPrismaUniqueError(error) || attempt === 2) throw error;
      }
    }
    throw new Error("工单编号生成失败，请重试");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "创建售后工单失败" }, { status: isPrismaUniqueError(error) ? 409 : 400 });
  }
}
