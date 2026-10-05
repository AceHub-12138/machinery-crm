// 区域选项
export const REGIONS = ["华北", "华南", "华东", "外贸", "其他"] as const;

// 客户状态标签
export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  NEW_LEAD: "新线索",
  CONTACTED: "已联系",
  QUOTED: "已报价",
  NEGOTIATING: "谈判中",
  WON: "已成交",
  LOST: "已流失",
  INACTIVE: "暂停跟进",
};

// 客户类型标签
export const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  NEW: "新客户",
  OLD: "老客户",
  AGENT: "代理商",
  END_USER: "终端用户",
  DISTRIBUTOR: "经销商",
};

// 客户等级
export const CUSTOMER_LEVELS = ["A", "B", "C", "D"] as const;

// 客户来源
export const CUSTOMER_SOURCES = [
  "展会",
  "阿里巴巴",
  "官网",
  "抖音",
  "微信",
  "老客户介绍",
  "电话开发",
  "外贸询盘",
  "其他",
] as const;

// 产品兴趣标签
export const INTEREST_TAGS = [
  "数控插床",
  "数控插齿机",
  "插床",
  "刨床",
  "自动化设备",
  "高意向",
  "价格敏感",
  "需要报价",
  "外贸客户",
  "代理商",
] as const;

// 跟进方式标签
export const FOLLOW_TYPE_LABELS: Record<string, string> = {
  PHONE: "电话",
  WECHAT: "微信",
  EMAIL: "邮件",
  WHATSAPP: "WhatsApp",
  VIDEO: "视频会议",
  VISIT: "到厂拜访",
  EXHIBITION: "展会",
  OTHER: "其他",
};

// 产品分类
export const PRODUCT_CATEGORIES = [
  "数控插床",
  "数控插齿机",
  "插床",
  "刨床",
  "加工中心",
  "其他设备",
] as const;

// 语言标签
export const LANGUAGE_LABELS: Record<string, string> = {
  ZH: "中文",
  EN: "English",
  ES: "Español",
  RU: "Русский",
};

// 角色标签
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "超级管理员",
  SALES: "销售",
  FOREIGN_TRADE: "外贸业务",
  PURCHASE: "采购",
  WAREHOUSE: "仓库管理",
};
