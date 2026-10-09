-- 只读核查；不含公司名、人员、目标金额或其他业务明细。
-- 使用获准的生产只读连接执行。不得在此脚本中增加 UPDATE / DELETE。
SELECT periodType, periodYear, periodIndex, metric, COUNT(*) AS duplicateCount
FROM sales_targets
WHERE salesUserId IS NULL
GROUP BY periodType, periodYear, periodIndex, metric
HAVING COUNT(*) > 1
ORDER BY periodYear DESC, periodIndex DESC, periodType, metric;
