// ===========================================
// EXPRESS TYPE EXTENSIONS
// ===========================================
// Extend Express Request with custom properties
// This allows TypeScript to know about our custom user object

import { UserRole } from '@prisma/client';
import { Readable } from 'stream';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: UserRole;
        creator?: { id: string } | null;
        company?: { id: string } | null;
      };
      guestId?: string;
      io?: unknown;
    }

    namespace Multer {
      interface File {
        fieldname: string;
        originalname: string;
        encoding: string;
        mimetype: string;
        size: number;
        destination: string;
        filename: string;
        path: string;
        buffer: Buffer;
        stream: Readable;
      }
    }
  }
}

// Make the global declaration available
export {};