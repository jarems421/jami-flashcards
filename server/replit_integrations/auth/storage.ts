import { db } from "../../db";

export interface UpsertUser {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}

export interface User {
  id: string;
  email: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface IAuthStorage {
  getUser(id: string): Promise<User | null>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUsername(id: string, username: string): Promise<User>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | null> {
    return db.user.findUnique({ where: { id } });
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    return db.user.upsert({
      where: { id: userData.id },
      create: {
        id: userData.id,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profileImageUrl: userData.profileImageUrl,
      },
      update: {
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        profileImageUrl: userData.profileImageUrl,
      },
    });
  }
  
  async updateUsername(id: string, username: string): Promise<User> {
    return db.user.update({
      where: { id },
      data: { username }
    });
  }
}

export const authStorage = new AuthStorage();
