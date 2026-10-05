-- 仅回滚本次纯新增表；执行前请确认不存在需要保留的售后工单数据。
DROP TABLE IF EXISTS `after_sales_order_parts`;
DROP TABLE IF EXISTS `after_sales_supplement_parts`;
DROP TABLE IF EXISTS `after_sales_orders`;
