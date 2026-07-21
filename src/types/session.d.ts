import 'cookie-session';

declare module 'cookie-session' {
  interface CookieSessionObject {
    admin?: boolean;
  }
}
