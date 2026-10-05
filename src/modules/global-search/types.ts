export type SearchResultType =
  | "nav"
  | "customer"
  | "contract"
  | "product"
  | "material"
  | "purchase-order"
  | "production-order"
  | "after-sales-order";

export type SearchResult = {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  group: string;
};
