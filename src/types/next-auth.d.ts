import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      roles: string[];
      permissions: string[];
    };
  }

  interface User {
    roles?: string[];
    permissions?: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    roles?: string[];
    permissions?: string[];
  }
}
