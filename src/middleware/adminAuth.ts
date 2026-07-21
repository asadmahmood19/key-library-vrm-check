import { Request, Response, NextFunction } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session && (req.session as { admin?: boolean }).admin === true) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
}
