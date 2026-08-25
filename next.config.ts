import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Traces the server and only the dependencies it actually reaches into
   * `.next/standalone`, which is what gets copied into the Lambda image. The
   * alternative is shipping all of node_modules — several hundred megabytes of
   * it — and paying for the cold start every time.
   */
  output: 'standalone',
};

export default nextConfig;
