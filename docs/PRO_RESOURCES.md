# Pro Resources (Reseau Pro)

Producer-only directory of partners, tools, and services. Admins manage categories and resources.

## Data model
Tables:
- `pro_resource_categories`
- `pro_resources`

Fields (overview):
- Category: `id`, `name`, `slug`, `description`, `color`, `sort_order`, `active`
- Resource: `id`, `category_id`, `name`, `description`, `logo_url`, `website_url`, `email`, `phone`, `city`, `region`, `tags`, `featured`, `active`, `sort_order`

Type definitions:
- [src/types/pro-resources.ts](../src/types/pro-resources.ts)

## Access rules
- Producers and admins can view the directory in the app.
- Admin-only management via Edge Function.

## App screens
- Producer directory: [src/app/(tabs)/reseau-pro.tsx](../src/app/(tabs)/reseau-pro.tsx)
- Admin management: [src/app/(tabs)/admin.tsx](../src/app/(tabs)/admin.tsx)

## API usage
### Read (producer/admin)
Uses REST with authenticated headers:
- `GET /rest/v1/pro_resource_categories?active=eq.true&order=sort_order.asc`
- `GET /rest/v1/pro_resources?active=eq.true&order=featured.desc,sort_order.asc,name.asc`

Hook implementation:
- [src/lib/hooks/useProResources.ts](../src/lib/hooks/useProResources.ts)

### Admin mutations
Edge Function: `pro-resources-admin`
- `GET` returns `{ categories, resources }`
- `POST` with `{ type: 'category' | 'resource', data: ... }`
- `PATCH` with `{ type, id, ...updates }`
- `DELETE` with `{ type, id }`

Client helpers:
- [src/lib/supabase-pro-resources.ts](../src/lib/supabase-pro-resources.ts)

Function implementation:
- [supabase/functions/pro-resources-admin/index.ts](../supabase/functions/pro-resources-admin/index.ts)

## Notes
- Category icons are mapped by slug with a fallback in the UI.
- Sorting is controlled by `featured` and `sort_order`.
