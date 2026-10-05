-- 仅回滚本次新增列；执行前确认不需要保留已填写的服务地址和满意度。
ALTER TABLE `after_sales_orders`
  DROP COLUMN `serviceAddress`,
  DROP COLUMN `satisfaction`;
