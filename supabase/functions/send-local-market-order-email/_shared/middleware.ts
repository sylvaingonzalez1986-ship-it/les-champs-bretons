/**
 * Request Validation Middleware - Les Chanvriers Unis
 *
 * Provides unified request validation for all Edge Functions.
 * Combines authentication, rate limiting, and schema validation.
 *
 * @module middleware
 */

import { createClient, SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import {
  validateSchema,
  createValidationErrorResponse,
  ValidationResult,
} from './validation.ts';
import {
  checkRateLimit,
  createRateLimitResponse,
  RateLimitConfig,
  RATE_LIMIT_PRESETS,
  logSecurityEvent,
} from './rate-limit.ts';
import { corsHeaders } from './cors.ts';

// =============================================================================
// TYPES
// =============================================================================
export * from '../../_shared/middleware.ts';
    // -------------------------------------------------------------------------
    // 3. PARSE REQUEST BODY
    // -------------------------------------------------------------------------
    let body: unknown;
    try {
      const contentType = req.headers.get('content-type') || '';

      if (req.method === 'GET') {
        // Parse query parameters for GET requests
        const url = new URL(req.url);
        body = Object.fromEntries(url.searchParams.entries());
      } else if (contentType.includes('application/json')) {
        body = await req.json();
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await req.formData();
        body = Object.fromEntries(formData.entries());
      } else {
        body = {};
      }
    } catch (parseError) {
      logSecurityEvent({
        userId,
        action: 'parse_error',
        endpoint: functionName,
        ip,
        userAgent,
        success: false,
        reason: 'Invalid request body',
      });

      return new Response(
        JSON.stringify({
          error: 'PARSE_ERROR',
          message: 'Invalid request body. Expected valid JSON.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // -------------------------------------------------------------------------
    // 4. VALIDATE SCHEMA
    // -------------------------------------------------------------------------
    const validationResult: ValidationResult<T> = validateSchema(schema, body);

    if (!validationResult.success) {
      logSecurityEvent({
        userId,
        action: 'validation_failed',
        endpoint: functionName,
        ip,
        userAgent,
        success: false,
        reason: validationResult.error?.details.map(d => d.message).join(', '),
      });

      return createValidationErrorResponse(validationResult.error!, corsHeaders);
    }

    // -------------------------------------------------------------------------
    // 5. EXECUTE HANDLER
    // -------------------------------------------------------------------------
    try {
      const validatedRequest: ValidatedRequest<T> = {
        user: user!,
        data: validationResult.data!,
        supabase,
        ip,
        userAgent,
      };

      const response = await handler(validatedRequest, req);
      const duration = Date.now() - startTime;

      console.log(`[${functionName}] ${userId} - ${req.method} - ${response.status} (${duration}ms)`);

      return response;

    } catch (handlerError) {
      const errorMessage = handlerError instanceof Error ? handlerError.message : 'Unknown error';

      logSecurityEvent({
        userId,
        action: 'handler_error',
        endpoint: functionName,
        ip,
        userAgent,
        success: false,
        reason: errorMessage,
      });

      console.error(`[${functionName}] Handler error:`, handlerError);

      return new Response(
        JSON.stringify({
          error: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  };
}

// =============================================================================
// UTILITY EXPORTS
// =============================================================================

export { RATE_LIMIT_PRESETS } from './rate-limit.ts';
export * from './validation.ts';

