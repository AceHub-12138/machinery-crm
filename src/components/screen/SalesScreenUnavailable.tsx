/**
 * 「大屏不可用」安全降级页。
 *
 * 无效、撤销、关闭或错误的链接统一表现为「大屏不可用」；
 * 未知异常表现为「大屏暂时不可用」。两者都不跳转登录页，
 * 不输出失败原因、堆栈、数据库信息或配置。
 */
export function SalesScreenUnavailable({ temporary = false }: { temporary?: boolean }) {
  return (
    <div className="sales-screen-root sales-screen-unavailable">
      <div className="screen-unavailable-box" role="status">
        <p className="screen-unavailable-title">{temporary ? "大屏暂时不可用" : "大屏不可用"}</p>
        <p className="screen-unavailable-hint">请稍后重试或联系管理员</p>
      </div>
    </div>
  );
}
