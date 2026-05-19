# SSL Certificates

Place your SSL certificates in this directory:

- `cert.pem` - SSL certificate
- `key.pem` - Private key

For development, you can generate self-signed certificates:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout key.pem -out cert.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

For production, use Let's Encrypt or your certificate provider.