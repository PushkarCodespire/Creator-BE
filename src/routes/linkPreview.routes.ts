// ===========================================
// LINK PREVIEW ROUTES
// ===========================================

import { Router } from 'express';
import { getLinkPreview, generateDescriptionFromUrl } from '../controllers/linkPreview.controller';

const router = Router();

// GET link preview (no auth required - can be used in public messages)
router.get('/link-preview', getLinkPreview);

// POST generate AI description from a URL
router.post('/link-preview/generate-description', generateDescriptionFromUrl);

export default router;
