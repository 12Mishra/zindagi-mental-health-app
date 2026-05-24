type AuthUser = {
  id: string;
  phoneNumber: string;
  fullName: string;
};

type AuthSession = {
  token: string;
  expiresAt: string;
};

let currentAuth:
  | {
      user: AuthUser;
      session: AuthSession;
    }
  | null = null;

export const setAuthSession = (auth: typeof currentAuth) => {
  currentAuth = auth;
};

export const getAuthSession = () => currentAuth;

export const clearAuthSession = () => {
  currentAuth = null;
};
