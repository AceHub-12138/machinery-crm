export type LeadUserSummary = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

export type HumanLeadListItem = {
  id: string;
  companyName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  aiScore: number | null;
  reviewStatus: string;
  searchKeyword: string | null;
  source: string;
  assignedUserId: string | null;
  assignedUser: LeadUserSummary | null;
  createdAt: string;
  feedbackVersion: number;
};

export type HumanLeadListResponse = {
  items: HumanLeadListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type HumanLeadFeedbackEvent = {
  id: string;
  leadId: string;
  reviewStatus: string | null;
  reviewReasonCode: string | null;
  comment: string | null;
  reviewedByUserId: string | null;
  reviewedByUser: LeadUserSummary | null;
  reviewedAt: string;
};

export type HumanLeadDetail = Omit<HumanLeadListItem, "assignedUser"> & {
  sourceUrl: string | null;
  profile: unknown;
  sourceModelVersion: string | null;
  extractorVersion: string | null;
  reviewedByUserId: string | null;
  reviewedByUser: LeadUserSummary | null;
  reviewedAt: string | null;
  updatedAt: string;
  assignedUser: LeadUserSummary | null;
  feedbackEvents: HumanLeadFeedbackEvent[];
};
