-- 售后工单服务地址与满意度：仅新增可空列，不修改既有列或历史数据。
ALTER TABLE `after_sales_orders`
  ADD COLUMN `serviceAddress` VARCHAR(255) NULL,
  ADD COLUMN `satisfaction` VARCHAR(191) NULL;
