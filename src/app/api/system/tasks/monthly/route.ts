import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/permissions";
import { isDomainError } from "@/modules/shared/domain-error";
import { listUnifiedTasks } from "@/modules/system/tasks/service";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthFor(date: string) {
  return date.slice(0, 7);
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const month = new URL(request.url).searchParams.get("month") || currentMonth();
    if (!MONTH_PATTERN.test(month)) {
      return NextResponse.json({ error: "month 参数必须为 YYYY-MM" }, { status: 400 });
    }

    const taskLists = await Promise.all(
      ["inbox", "approval", "initiated", "handled"].map((view) => listUnifiedTasks(user, view)),
    );
    const tasksById = new Map(taskLists.flat().map((task) => [task.id, task]));
    const items = [...tasksById.values()]
      .map((task) => {
        const dateField = task.dueAt ? "dueAt" : "createdAt";
        const date = task.dueAt || task.createdAt;
        return { task, dateField, date };
      })
      .filter(({ date }) => monthFor(date) === month)
      .map(({ task, dateField }) => ({
        sourceType: task.sourceType,
        sourceId: task.sourceId,
        module: task.module,
        taskType: task.taskType,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt,
        createdAt: task.createdAt,
        dateField,
        href: task.href,
      }))
      .sort((a, b) => (a.dueAt || a.createdAt).localeCompare(b.dueAt || b.createdAt));

    return NextResponse.json({ month, items });
  } catch (error) {
    return NextResponse.json(
      { error: isDomainError(error) ? error.message : "月任务加载失败" },
      { status: isDomainError(error) ? error.status : 500 },
    );
  }
}
