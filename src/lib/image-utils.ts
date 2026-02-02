type ImageSource = number | { uri: string } | undefined;

function optimizeSupabaseImageUrl(url: string, width: number, quality: number): string {
  try {
    if (!url.includes('/storage/v1/object/public/')) {
      return url;
    }

    if (url.includes('/storage/v1/render/image/public/')) {
      return url;
    }

    const parsed = new URL(url);
    const marker = '/storage/v1/object/public/';
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) {
      return url;
    }

    const path = parsed.pathname.slice(index + marker.length);
    parsed.pathname = `/storage/v1/render/image/public/${path}`;
    parsed.searchParams.set('width', String(width));
    parsed.searchParams.set('quality', String(quality));
    parsed.searchParams.set('format', 'webp');
    return parsed.toString();
  } catch {
    return url;
  }
}

function optimizeUnsplashUrl(url: string, width: number, quality: number): string {
  try {
    if (!url.includes('images.unsplash.com')) {
      return url;
    }
    const parsed = new URL(url);
    parsed.searchParams.set('w', String(width));
    parsed.searchParams.set('q', String(quality));
    parsed.searchParams.set('auto', 'format');
    parsed.searchParams.set('fit', 'crop');
    return parsed.toString();
  } catch {
    return url;
  }
}

export function optimizeImageUrl(url: string, width = 800, quality = 80): string {
  if (!url) return url;
  const supabaseOptimized = optimizeSupabaseImageUrl(url, width, quality);
  if (supabaseOptimized !== url) return supabaseOptimized;
  return optimizeUnsplashUrl(url, width, quality);
}

export function optimizeImageSource(source: ImageSource, width = 800, quality = 80): ImageSource {
  if (!source) return source;
  if (typeof source === 'number') return source;
  if (source.uri) {
    return { uri: optimizeImageUrl(source.uri, width, quality) };
  }
  return source;
}
