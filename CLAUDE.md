<stack>
  Expo SDK 53, React Native 0.76.7, bun (not npm).
  React Query for server/async state.
  NativeWind + Tailwind v3 for styling.
  react-native-reanimated v3 for animations (preferred over Animated from react-native).
  react-native-gesture-handler for gestures.
  lucide-react-native for icons.
  All packages are pre-installed. DO NOT install new packages unless they are @expo-google-font packages or pure JavaScript helpers like lodash, dayjs, etc.
</stack>

<structure>
  src/app/          — Expo Router file-based routes (src/app/_layout.tsx is root). Add new screens to this folder.
  src/components/   — Reusable UI components. Add new components to this folder.
  src/lib/          — Utilities: cn.ts (className merge), example-context.ts (state pattern)
</structure>

<typescript>
  Explicit type annotations for useState: `useState<Type[]>([])` not `useState([])`
  Null/undefined handling: use optional chaining `?.` and nullish coalescing `??`
  Include ALL required properties when creating objects — TypeScript strict mode is enabled.
</typescript>

<environment>
  You are in Vibecode. The system manages git and the dev server (port 8081).
  DO NOT: manage git, touch the dev server, or check its state.
  The user views the app through Vibecode App.
  The user cannot see the code or interact with the terminal. Do not tell the user to do anything with the code or terminal.
  You can see logs in the expo.log file.
  The Vibecode App has tabs like ENV tab, API tab, LOGS tab. You can ask the user to use these tabs to view the logs, add enviroment variables, or give instructions for APIs like OpenAI, Nanobanana, Grok, Elevenlabs, etc. but first try to implement the functionality yourself.
  The user is likely non-technical, communicate with them in an easy to understand manner.
  If the user's request is vague or ambitious, scope down to specific functionality. Do everything for them.
  For images, use URLs from unsplash.com. You can also tell the user they can use the IMAGES tab to generate and uplooad images.
</environment>


<forbidden_files>
  Do not edit: patches/, babel.config.js, metro.config.js, app.json, tsconfig.json, nativewind-env.d.ts
</forbidden_files>

<routing>
  Expo Router for file-based routing. Every file in src/app/ becomes a route.
  Never delete or refactor RootLayoutNav from src/app/_layout.tsx.
  
  <stack_router>
    src/app/_layout.tsx (root layout), src/app/index.tsx (matches '/'), src/app/settings.tsx (matches '/settings')
    Use <Stack.Screen options={{ title, headerStyle, ... }} /> inside pages to customize headers.
  </stack_router>
  
  <tabs_router>
    Only files registered in src/app/(tabs)/_layout.tsx become actual tabs.
    Unregistered files in (tabs)/ are routes within tabs, not separate tabs.
    Nested stacks create double headers — remove header from tabs, add stack inside each tab.
    At least 2 tabs or don't use tabs at all — single tab looks bad.
  </tabs_router>
  
  <router_selection>
    Games should avoid tabs — use full-screen stacks instead.
    For full-screen overlays/modals outside tabs: create route in src/app/ (not src/app/(tabs)/), 
    then add `<Stack.Screen name="page" options={{ presentation: "modal" }} />` in src/app/_layout.tsx.
  </router_selection>
  
  <rules>
    Only ONE route can map to "/" — can't have both src/app/index.tsx and src/app/(tabs)/index.tsx.
    Dynamic params: use `const { id } = useLocalSearchParams()` from expo-router.
  </rules>
</routing>

<state>
  React Query for server/async state. Always use object API: `useQuery({ queryKey, queryFn })`.
  Never wrap RootLayoutNav directly.
  React Query provider must be outermost; nest other providers inside it.
  
  Use `useMutation` for async operations — no manual `setIsLoading` patterns.
  Wrap third-party lib calls (RevenueCat, etc.) in useQuery/useMutation for consistent loading states.
  Reuse query keys across components to share cached data — don't create duplicate providers.
  
  For local state, use Zustand. However, most state is server state, so use React Query for that.
  Always use a selector with Zustand to subscribe only to the specific slice of state you need (e.g., useStore(s => s.foo)) rather than the whole store to prevent unnecessary re-renders. Make sure that the value returned by the selector is a primitive. Do not execute store methods in selectors; select data/functions, then compute outside the selector.
  For persistence: use AsyncStorage inside context hook providers. Only persist necessary data.
  Split ephemeral from persisted state to avoid hydration bugs.
</state>

<safearea>
  Import from react-native-safe-area-context, NOT from react-native.
  Skip SafeAreaView inside tab stacks with navigation headers.
  Skip when using native headers from Stack/Tab navigator.
  Add when using custom/hidden headers.
  For games: use useSafeAreaInsets hook instead.
</safearea>

<data>
  Create realistic mock data when you lack access to real data.
  For image analysis: actually send to LLM don't mock.
</data>

<design>
  Don't hold back. This is mobile — design for touch, thumb zones, glanceability.
  Inspiration: iOS, Instagram, Airbnb, Coinbase, polished habit trackers.

  <avoid>
    Purple gradients on white, generic centered layouts, predictable patterns.
    Web-like designs on mobile. Overused fonts (Space Grotesk, Inter).
  </avoid>

  <do>
    Cohesive themes with dominant colors and sharp accents.
    High-impact animations: progress bars, button feedback, haptics.
    Depth via gradients and patterns, not flat solids.
    Install `@expo-google-fonts/{font-name}` for fonts (eg: `@expo-google-fonts/inter`)
    Use zeego for context menus and dropdowns (native feel). Lookup the documentation on zeego.dev to see how to use it.
  </do>
</design>

<mistakes>
  <styling>
    Use Nativewind for styling. Use cn() helper from src/lib/cn.ts to merge classNames when conditionally applying classNames or passing classNames via props.
    CameraView, LinearGradient, and Animated components DO NOT support className. Use inline style prop.
    Horizontal ScrollViews will expand vertically to fill flex containers. Add `style={{ flexGrow: 0 }}` to constrain height to content.
  </styling>

  <camera>
    Use CameraView from expo-camera, NOT the deprecated Camera import.
    import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
    Use style={{ flex: 1 }}, not className.
    Overlay UI must be absolute positioned inside CameraView.
  </camera>

  <react_native>
    No Node.js buffer in React Native — don't import from 'buffer'.
  </react_native>

  <ux>
    Use Pressable over TouchableOpacity.
    Use custom modals, not Alert.alert().
    Ensure keyboard is dismissable and doesn't obscure inputs. Use KeyboardAvoidingView from react-native and Keyboard.dismiss() for keyboard handling.
  </ux>

  <outdated_knowledge>
    Your react-native-reanimated and react-native-gesture-handler training may be outdated. Look up current docs before implementing.
  </outdated_knowledge>
</mistakes>

<appstore>
  Cannot assist with App Store or Google Play submission processes (app.json, eas.json, EAS CLI commands).
  For submission help, click "Share" on the top right corner on the Vibecode App and select "Submit to App Store".
</appstore> 

<skills>
You have access to a few skills in the `.claude/skills` folder. Use them to your advantage.
- ai-apis-like-chatgpt: Use this skill when the user asks you to make an app that requires an AI API.
- expo-docs: Use this skill when the user asks you to use an Expo SDK module or package that you might not know much about.
- frontend-app-design: Use this skill when the user asks you to design a frontend app component or screen.
</skills>

<security_architecture>
## CRITICAL: Backend-First Security Model
This project enforces a STRICT "Backend-First" security model to prevent Vibe Coding vulnerabilities.

### 1. NEVER Trust the Client
- **NEVER** write business logic in Client Components.
- **NEVER** use `supabase-js` client methods (`.select`, `.insert`, `.update`, `.delete`) directly in frontend for sensitive operations.
- **ALWAYS** use Supabase Edge Functions or authenticated API endpoints for ALL data mutations.
- The Frontend is a View Layer only. It speaks to APIs, not the Database directly for writes.
- **ALWAYS** validate inputs server-side — never trust client-provided data.

### 2. The "Direct-to-DB" Trap
Never allow frontend to directly modify sensitive fields. Example of DANGEROUS code:
```javascript
// ❌ NEVER DO THIS — user can modify any field including is_admin, role, subscription_status
supabase.from('users').update({ is_pro: true }).eq('id', user.id)
```
Instead, use Edge Functions where the server controls which columns can be modified.

### 3. RLS Policy Requirements (Supabase)
- **RLS IS MANDATORY:** Enable Row Level Security on EVERY table immediately after creation.
- RLS protects rows, NOT columns — always restrict which columns users can update via Edge Functions.
- Use helper functions (`is_admin()`, `is_producer()`) to verify roles.
- Test policies with different user roles before deploying.
- **REVOKE public access** to all Postgres functions:
  ```sql
  REVOKE EXECUTE ON FUNCTION function_name FROM public;
  REVOKE EXECUTE ON FUNCTION function_name FROM anon;
  GRANT EXECUTE ON FUNCTION function_name TO service_role;
  ```

### 4. Rate Limiting is MANDATORY
Without rate limits, attackers can:
- Brute force magic links/OTP codes
- Insert millions of rows to bloat your database
- Enumerate IDs to find valid records
- DDoS your wallet via Stripe calls
Apply limits to:
- All API routes
- Auth endpoints
- Webhooks
- File upload endpoints

### 5. Storage Security
- **NO PUBLIC BUCKETS** for sensitive user data (photos, documents, invoices).
- **UUID FILENAMES:** Always rename files to `crypto.randomUUID()` to prevent enumeration attacks.
- **SIGNED URLS:** Always use `createSignedUrl` with expiration for file access. Never expose direct paths.
- Validate file types and sizes server-side before accepting uploads.

### 6. Environment Variables & Secrets
- **NEVER** hardcode secrets in code — always use `process.env.VAR_NAME`.
- **NEVER** commit `.env` files — ensure `.gitignore` includes all env files.
- The `service_role` key must ONLY exist in Edge Function environment variables.
- The `anon` key is NOT safe — it exposes your database schema via REST API.

### 7. Webhook Security (Stripe, LemonSqueezy, etc.)
- **NEVER** trust `req.body` directly for payment webhooks.
- **ALWAYS** verify cryptographic signatures using provider SDK (e.g., `stripe.webhooks.constructEvent`).
- If signature verification fails, reject immediately with `400`.
- Use randomized webhook URL paths (e.g., `/webhooks/stripe-a8f3x9k` not `/webhooks/stripe`).

### 8. Mobile-Specific Concerns
- Logic bugs in frontend cannot be hot-fixed — App Store review takes 48+ hours.
- **NEVER** put pricing logic, subscription validation, or business rules in the frontend.
- Always verify subscription status server-side before granting access.

### 9. Input Validation
- **TRUST NO ONE:** Validate ALL inputs in Edge Functions using Zod or similar.
- Sanitize user-provided strings to prevent injection attacks.
- Validate file uploads: check MIME type, file size, and content.

### 10. Compliance Check
Before generating any code that accesses data, ask:
> "Is this code asking the Frontend to talk to the Database directly?"
> If YES → REJECT IT. Write an Edge Function or server-side action instead.

### Existing Security in This Project
- RLS is enabled on all tables (see `database/RLS_DOCUMENTATION.md`)
- Rate limiting implemented in `src/lib/supabase-auth.ts`
- Authenticated headers used for sensitive operations in `src/lib/supabase-sync.ts`
- File upload validation in `database/migrations/validate_file_uploads.sql`
- RGPD compliance functions with proper access controls
</security_architecture>

<hemptycoon_integration>
## 🎮 Intégration HempTycoon (Jeu RPG)

Cette app partage son backend Supabase avec **HempTycoon**, un jeu mobile RPG de culture de chanvre.

### Principe
```
HempTycoon (Jeu) ←→ Supabase (Partagé) ←→ Les Chanvriers (Boutique)
                         ↓
                   Tickets partagés
                         ↓
            1 ticket jeu = 1 ticket boutique = 1 tirage
```

### Système de Tickets Centralisé
Les tickets ne sont plus stockés localement (Zustand). Ils sont maintenant dans Supabase.

**Tables à créer :**
```sql
-- Voir supabase/migrations/YYYYMMDD_tickets_centralized.sql
-- user_tickets : Solde de tickets par user
-- ticket_transactions : Historique des gains/dépenses
```

**Migration du store local :**
Le `useSubscriptionStore` doit lire/écrire depuis Supabase au lieu de AsyncStorage.

### Sources de Tickets
| Source | Déclencheur | Quantité |
|--------|-------------|----------|
| Achat boutique | 25€ dépensés | 1 ticket |
| Abonnement | Mensuel | 1-3 selon tier |
| HempTycoon | Classement hebdo | 1-10 selon rang |
| HempTycoon | Classement saison | 5-50 selon rang |
| HempTycoon | Achievements | 1-10 |

### Edge Function `award-tickets`
Seul moyen d'ajouter des tickets. Jamais le client directement.
- Vérifie signature HMAC
- Valide les règles métier
- Transaction atomique (balance + log)

### Modifications requises dans cette app
1. **Migrer `useSubscriptionStore.tickets`** vers requête Supabase
2. **Créer hook `useTicketBalance()`** qui fetch depuis `user_tickets`
3. **Modifier le tirage** pour appeler une Edge Function qui décrémente les tickets
4. **Deep linking** : `chanvriers://rewards?source=hemptycoon`

### Sécurité Cross-App
- Le jeu ne peut PAS attribuer de tickets directement
- Toute attribution passe par Edge Function avec signature HMAC
- Les replays de jeu sont stockés pour audit si contestation
- Top 10 du classement = review manuel avant attribution
</hemptycoon_integration>