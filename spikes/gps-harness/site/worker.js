// Serves the GPS Spike APK from R2 (too big for Workers static assets' 25 MiB cap).
// Everything else in ./public is served as a static asset before this runs.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/gps-spike.apk') {
      const obj = await env.APK.get('gps-spike.apk');
      if (!obj) return new Response('APK not uploaded yet', { status: 404 });
      return new Response(obj.body, {
        headers: {
          'content-type': 'application/vnd.android.package-archive',
          'content-length': String(obj.size),
          'content-disposition': 'attachment; filename="gps-spike.apk"',
          'cache-control': 'no-store',
        },
      });
    }
    return new Response('Not found', { status: 404 });
  },
};
