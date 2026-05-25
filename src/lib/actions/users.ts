'use server';

import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/authz';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';

const M = 'users.manage';

export async function getUsers() {
  await requirePermission(M);
  return prisma.user.findMany({
    include: { roles: { include: { role: true } } },
    orderBy: { fullName: 'asc' },
  });
}

export async function getRoles() {
  await requirePermission(M);
  return prisma.role.findMany({ orderBy: { name: 'asc' } });
}

export async function createUser(data: {
  email: string;
  fullName: string;
  phone?: string;
  password: string;
  roleIds: string[];
  isActive?: boolean;
}) {
  await requirePermission(M);
  const u = await prisma.user.create({
    data: {
      email: data.email,
      fullName: data.fullName,
      phone: data.phone,
      passwordHash: bcrypt.hashSync(data.password, 10),
      isActive: data.isActive ?? true,
      roles: { create: (data.roleIds || []).map((roleId) => ({ roleId })) },
    },
  });
  revalidatePath('/admin/users');
  return { id: u.id };
}

export async function updateUser(id: string, data: {
  fullName?: string;
  phone?: string;
  isActive?: boolean;
  roleIds?: string[];
}) {
  await requirePermission(M);
  if (Array.isArray(data.roleIds)) {
    await prisma.userRole.deleteMany({ where: { userId: id } });
    if (data.roleIds.length) {
      await prisma.userRole.createMany({ data: data.roleIds.map((roleId) => ({ userId: id, roleId })) });
    }
  }
  await prisma.user.update({
    where: { id },
    data: { fullName: data.fullName, phone: data.phone, isActive: data.isActive },
  });
  revalidatePath('/admin/users');
}

export async function resetUserPassword(id: string, password: string) {
  await requirePermission(M);
  await prisma.user.update({ where: { id }, data: { passwordHash: bcrypt.hashSync(password, 10) } });
  revalidatePath('/admin/users');
}

export async function deleteUser(id: string) {
  await requirePermission(M);
  await prisma.userRole.deleteMany({ where: { userId: id } });
  await prisma.session.deleteMany({ where: { userId: id } });
  await prisma.user.delete({ where: { id } });
  revalidatePath('/admin/users');
}
