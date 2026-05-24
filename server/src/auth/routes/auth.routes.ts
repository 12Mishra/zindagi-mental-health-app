import { Router } from 'express';

import {
  getSessionController,
  loginController,
  logoutController,
  registerController,
  sendOtpController,
  verifyController,
} from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth.middleware';

export const authRouter = Router();

authRouter.post('/send-otp', sendOtpController);
authRouter.post('/login', loginController);
authRouter.post('/register', registerController);
authRouter.post('/verify', verifyController);
authRouter.get('/session', requireAuth, getSessionController);
authRouter.post('/logout', requireAuth, logoutController);
