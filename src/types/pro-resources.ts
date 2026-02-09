/**
 * Pro Resources types — shared across hook, components, and screen
 */

export interface ProResourceCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  sort_order: number;
  active: boolean;
}

export interface ProResource {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  tags: string[];
  featured: boolean;
  active: boolean;
  sort_order: number;
}
