import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, isSuperAdmin, canSeeAllData, customerIsolationWhere, canAccessCustomer } from "@/lib/permissions";
import { writeOperationLog } from "@/lib/sales-items";
import { contractStatusWhere, localStartOfDay, parseLocalDate } from "@/modules/crm/dashboard/kpi-linkage";

const SHIPMENT_STATUS = ["NOT_SHIPPED", "PARTIAL_SHIPPED", "SHIPPED"];
const SHIPMENT_FILTER_STATUS = [...SHIPMENT_STATUS, "OVERDUE"];

function startOfDay(value: string) {
  return parseLocalDate(value)!;
}

function endExclusive(value: string) {
  const date = startOfDay(value);
  date.setDate(date.getDate() + 1);
  return date;
}

function validDate(value: string) {
  return Boolean(parseLocalDate(value));
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || "";
    const status = searchParams.get("status") || "";
    const contractId = searchParams.get("contractId") || "";
    const customerId = searchParams.get("customerId") || "";
    const region = searchParams.get("region") || "";
    const salesUserId = searchParams.get("salesUserId") || "";
    const kpiSalesUserId = searchParams.get("kpiSalesUserId") || "";
    const contractStatus = searchParams.get("contractStatus") || "";
    const createdById = searchParams.get("createdById") || "";
    const dateStart = searchParams.get("dateStart") || "";
    const dateEnd = searchParams.get("dateEnd") || "";

    if (status && !SHIPMENT_FILTER_STATUS.includes(status)) {
      return NextResponse.json({ error: "发货状态筛选值无效" }, { status: 400 });
    }
    if ((dateStart && !validDate(dateStart)) || (dateEnd && !validDate(dateEnd))) {
      return NextResponse.json({ error: "发货日期筛选格式错误" }, { status: 400 });
    }

    const customerConds: any[] = [];
    if (!canSeeAllData(user)) customerConds.push(customerIsolationWhere(user));
    else if (region) customerConds.push({ region });
    if (customerId) customerConds.push({ id: customerId });
    const province = searchParams.get("province") || "";
    const businessLine = searchParams.get("businessLine") || "";
    if (province) customerConds.push({ province });
    if (businessLine && canSeeAllData(user)) customerConds.push({ businessLine });
    if (kpiSalesUserId) {
      if (canSeeAllData(user) || kpiSalesUserId === user.id) customerConds.push({ assignedUserId: kpiSalesUserId });
      else customerConds.push({ id: "__NO_ACCESS__" });
    }
    const customerWhere: any = customerConds.length ? { AND: customerConds } : {};
    if (dateStart || dateEnd || status === "OVERDUE") customerWhere.deletedAt = null;

    const contractWhere: any = { deletedAt: null };
    if (Object.keys(customerWhere).length) contractWhere.customer = customerWhere;
    if (kpiSalesUserId && (canSeeAllData(user) || kpiSalesUserId === user.id)) contractWhere.salesUserId = kpiSalesUserId;
    else if (!kpiSalesUserId && salesUserId) contractWhere.salesUserId = salesUserId;
    Object.assign(contractWhere, contractStatusWhere(contractStatus));

    const where: any = { contract: contractWhere };
    if (contractId) where.contractId = contractId;
    if (status && status !== "OVERDUE") where.shipmentStatus = status;
    if (createdById) where.createdById = createdById;
    if (dateStart || dateEnd) {
      where.shipmentDate = {};
      if (dateStart) where.shipmentDate.gte = startOfDay(dateStart);
      if (dateEnd) where.shipmentDate.lt = endExclusive(dateEnd);
    }
    if (status === "OVERDUE") {
      where.shipmentDate = { lt: localStartOfDay(new Date()) };
      where.shipmentStatus = { not: "SHIPPED" };
    }

    if (search) {
      where.OR = [
        { equipmentName: { contains: search } },
        { driverPhone: { contains: search } },
        { receivingAddress: { contains: search } },
        { contract: { contractNo: { contains: search } } },
        { contract: { customer: { companyName: { contains: search } } } },
        { contract: { customer: { contactName: { contains: search } } } },
      ];
    }

    const shipments = await prisma.shipment.findMany({
      where,
      include: {
        contract: {
          select: {
            id: true,
            contractNo: true,
            equipmentName: true,
            equipmentModel: true,
            salesUserId: true,
            salesUser: { select: { id: true, name: true } },
            items: { orderBy: { sortOrder: "asc" } },
            customer: {
              select: {
                id: true,
                companyName: true,
                contactName: true,
                region: true,
                deletedAt: true,
              },
            },
          },
        },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ shipmentDate: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json(shipments);
  } catch (error) {
    console.error("[shipments.GET]", error);
    return NextResponse.json({ error: "发货记录加载失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请求数据格式错误，请刷新页面后重试" }, { status: 400 });
    }

    if (!body.contractId || !body.shipmentDate || !body.receivingAddress || !body.driverPhone || !body.equipmentName || !body.quantity) {
      return NextResponse.json({ error: "合同、发货日期、收货地址、司机电话、发货设备和数量为必填" }, { status: 400 });
    }
    if (!validDate(body.shipmentDate)) {
      return NextResponse.json({ error: "发货日期格式错误" }, { status: 400 });
    }
    if (body.shipmentStatus && !SHIPMENT_STATUS.includes(body.shipmentStatus)) {
      return NextResponse.json({ error: "发货状态无效" }, { status: 400 });
    }

    const contract = await prisma.contract.findFirst({
      where: { id: body.contractId, deletedAt: null },
      include: { customer: { select: { businessLine: true, province: true, city: true } } },
    });
    if (!contract) return NextResponse.json({ error: "合同不存在" }, { status: 404 });
    if (!canAccessCustomer(user, contract.customer)) {
      return NextResponse.json({ error: "无权限为该合同创建发货记录" }, { status: 403 });
    }

    const quantity = parseInt(String(body.quantity), 10);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "发货数量必须大于 0" }, { status: 400 });
    }
    if (!String(body.receivingAddress).trim() || !String(body.driverPhone).trim() || !String(body.equipmentName).trim()) {
      return NextResponse.json({ error: "收货地址、司机电话和发货设备不能为空" }, { status: 400 });
    }

    const shipment = await prisma.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          contractId: body.contractId,
          shipmentDate: new Date(body.shipmentDate),
          receivingAddress: String(body.receivingAddress).trim(),
          driverPhone: String(body.driverPhone).trim(),
          equipmentName: String(body.equipmentName).trim(),
          quantity,
          shipmentStatus: body.shipmentStatus || "NOT_SHIPPED",
          deliveryNoteUrl: body.deliveryNoteUrl || null,
          shipmentPhotoUrl: body.shipmentPhotoUrl || null,
          remark: body.remark || null,
          createdById: user.id,
        },
      });
      await writeOperationLog(tx, {
        userId: user.id,
        action: "CREATE_SHIPMENT",
        entityType: "Shipment",
        entityId: created.id,
        afterData: created,
      });
      return created;
    });

    return NextResponse.json(shipment, { status: 201 });
  } catch (error: any) {
    console.error("[shipments.POST]", error);
    return NextResponse.json({ error: error.message || "创建发货记录失败" }, { status: 400 });
  }
}
