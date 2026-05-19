# ===========================================
# NGINX API GATEWAY DOCKERFILE
# ===========================================

FROM nginx:alpine

# Install dependencies
RUN apk add --no-cache openssl

# Create SSL directory
RUN mkdir -p /etc/nginx/ssl

# Copy configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy SSL certificates (in production, mount these as volumes)
COPY ssl/cert.pem /etc/nginx/ssl/cert.pem
COPY ssl/key.pem /etc/nginx/ssl/key.pem

# Create log directory
RUN mkdir -p /var/log/nginx

# Expose ports
EXPOSE 80 443

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/health || exit 1

# Start NGINX
CMD ["nginx", "-g", "daemon off;"]