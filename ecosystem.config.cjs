/**
 * PM2 ecosystem for Alpha (alpha.moss.land).
 *
 * Pattern matches `media-kr` and `comply` (project_deployment_manifest.md).
 * Tailscale routing — nginx on Lightsail proxies via <LOCAL_TAILSCALE_IP>:6900.
 */
module.exports = {
  apps: [
    {
      name: "alpha-web",
      cwd: "<PROJECT_ROOT>",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 6900",
      env: {
        NODE_ENV: "production",
        PORT: "6900",
        NEXT_PUBLIC_BASE_URL: "https://alpha.moss.land",
      },
      max_memory_restart: "768M",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
    },
  ],
};
