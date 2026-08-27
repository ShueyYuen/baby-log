import { useState, useEffect, useRef, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { api } from '../lib/api';
import { cropAndResizeAvatar } from '../lib/avatar-crop';
import dayjs from 'dayjs';
import { UserPlus, Trash2, KeyRound, Copy, Check, User as UserIcon, Camera, Pencil } from 'lucide-react';
import { Button, Input, Card, CardContent, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, ConfirmDialog, useToast } from '../components/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';
import { SecondaryHeader } from '../components/SecondaryHeader';

import type { UserItem } from '../lib/api';

export default function AdminPage() {
  const { user: currentUser, isAdmin, loading } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'user' | 'viewer'>('user');
  const [creating, setCreating] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'delete' | 'reset';
    id: string;
    name: string;
  } | null>(null);
  const [editTarget, setEditTarget] = useState<UserItem | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const createAvatarFileRef = useRef<HTMLInputElement>(null);
  const [newAvatarPreview, setNewAvatarPreview] = useState<string | null>(null);
  const [newAvatarKey, setNewAvatarKey] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const res = await api.auth.listUsers();
      setUsers(res.data);
    } catch {
      toast(t('admin.loadFailed'), 'error');
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.auth.createUser({
        username: newUsername,
        displayName: newDisplayName,
        role: newUserRole,
      });
      if (newAvatarKey) {
        await api.auth.updateAvatar(res.data.id, newAvatarKey);
      }
      setGeneratedPassword(res.data.generatedPassword);
      setNewUsername('');
      setNewDisplayName('');
      setNewUserRole('user');
      setNewAvatarPreview(null);
      setNewAvatarKey(null);
      loadUsers();
    } catch (err: any) {
      toast(err.message || t('admin.createFailed'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    const { type, id } = confirmAction;
    setConfirmAction(null);

    if (type === 'delete') {
      try {
        await api.auth.deleteUser(id);
        toast(t('admin.deleted'), 'success');
        loadUsers();
      } catch (err: any) {
        toast(err.message || t('admin.deleteFailed'), 'error');
      }
    } else {
      try {
        const res = await api.post<{ success: boolean; data: { generatedPassword: string } }>(`/auth/users/${id}/reset-password`, {});
        setGeneratedPassword(res.data.generatedPassword);
      } catch (err: any) {
        toast(err.message || t('admin.resetFailed'), 'error');
      }
    }
  };

  const copyPassword = () => {
    navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (editDisplayName.trim() !== editTarget.displayName) {
        payload.displayName = editDisplayName.trim();
      }
      if (editRole !== editTarget.role && editTarget.id !== currentUser?.id) {
        payload.role = editRole;
      }
      if (Object.keys(payload).length > 0) {
        await api.auth.updateUser(editTarget.id, payload);
      }
      toast(t('admin.updated'), 'success');
      setEditTarget(null);
      loadUsers();
    } catch (err: any) {
      toast(err.message || t('admin.updateFailed'), 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const openEditUser = (u: UserItem) => {
    setEditTarget(u);
    setEditDisplayName(u.displayName);
    setEditRole(u.role);
  };

  const handleAvatarUpload = useCallback(async (file: File, userId?: string) => {
    setAvatarUploading(true);
    try {
      const cropped = await cropAndResizeAvatar(file);
      const formData = new FormData();
      formData.append('file', cropped);
      const targetId = userId || editTarget?.id;
      if (targetId) {
        const res = await api.put<{ success: boolean; data: { id: string; avatar: string } }>(`/auth/users/${targetId}/avatar`, formData);
        toast(t('admin.avatarUpdated'), 'success');
        loadUsers();
        if (editTarget) {
          setEditTarget({ ...editTarget, avatar: res.data.avatar });
        }
      } else {
        const uploadRes = await api.post<{ success: boolean; data: { url: string; key: string } }>('/upload', formData);
        const { url, key } = uploadRes.data;
        setNewAvatarPreview(url);
        setNewAvatarKey(key);
      }
    } catch (err: any) {
      toast(err.message || t('admin.uploadFailed'), 'error');
    } finally {
      setAvatarUploading(false);
    }
  }, [editTarget]);

  const roleBadge = (role: string) => {
    if (role === 'admin') return <Badge variant="info">{t('admin.roleAdmin')}</Badge>;
    if (role === 'viewer') return <Badge variant="secondary">{t('admin.roleViewer')}</Badge>;
    return <Badge variant="secondary">{t('admin.roleUser')}</Badge>;
  };

  if (loading) {
    return (
      <div className="absolute inset-0 glass-page-shell">
        <SecondaryHeader title={t('admin.title')} />
        <div className="glass-page-body custom-scrollbar flex justify-center">
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/me" replace />;

  return (
    <div className="absolute inset-0 glass-page-shell">
      <SecondaryHeader
        title={t('admin.title')}
        actions={
          <Button size="sm" onClick={() => { setShowCreateForm(true); setGeneratedPassword(''); }}>
            <UserPlus size={16} /> {t('admin.newUser')}
          </Button>
        }
      />
      <div className="glass-page-body custom-scrollbar space-y-6">
      <div className="space-y-3">
        {users.map((u) => (
          <Card key={u.id}>
            <CardContent className="flex items-center justify-between">
              <div
                className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                onClick={() => openEditUser(u)}
              >
                <div className="relative w-11 h-11 rounded-full overflow-hidden flex-shrink-0 glass-avatar-placeholder flex items-center justify-center group">
                  {u.avatar ? (
                    <img src={u.avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon size={20} className="text-gray-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-base dark:text-gray-100">{u.displayName}</span>
                    {roleBadge(u.role)}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    @{u.username} · {dayjs(u.createdAt).format('YYYY-MM-DD')}
                  </p>
                </div>
              </div>
              {u.id !== currentUser?.id && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => openEditUser(u)}
                    className="p-2 rounded-md text-gray-400 hover:text-primary-500 glass-icon-btn transition-colors"
                    title={t('admin.editUser')}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => setConfirmAction({ type: 'reset', id: u.id, name: u.displayName })}
                    className="p-2 rounded-md text-gray-400 hover:text-primary-500 glass-icon-btn transition-colors"
                    title={t('admin.resetPassword')}
                  >
                    <KeyRound size={16} />
                  </button>
                  <button
                    onClick={() => setConfirmAction({ type: 'delete', id: u.id, name: u.displayName })}
                    className="p-2 rounded-md text-gray-400 hover:text-red-500 glass-icon-btn transition-colors"
                    title={t('admin.deleteUser')}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title={confirmAction?.type === 'delete' ? t('admin.deleteUser') : t('admin.resetPassword')}
        description={
          confirmAction?.type === 'delete'
            ? t('admin.deleteConfirm', { name: confirmAction?.name ?? '' })
            : t('admin.resetConfirm', { name: confirmAction?.name ?? '' })
        }
        confirmLabel={confirmAction?.type === 'delete' ? t('common.delete') : t('admin.reset')}
        variant={confirmAction?.type === 'delete' ? 'danger' : 'default'}
        onConfirm={handleConfirm}
      />

      {/* Edit User Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.editTitle', { username: editTarget?.username ?? '' })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-2">
            {/* Avatar */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-20 h-20 rounded-full overflow-hidden glass-avatar-placeholder flex items-center justify-center group">
                {editTarget?.avatar ? (
                  <img src={editTarget.avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <UserIcon size={32} className="text-gray-400" />
                )}
                <button
                  onClick={() => avatarFileRef.current?.click()}
                  className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                >
                  <Camera size={20} className="text-white" />
                </button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={avatarUploading}
                  onClick={() => avatarFileRef.current?.click()}
                >
                  {avatarUploading ? t('common.uploading') : t('common.changeAvatar')}
                </Button>
                {editTarget?.avatar && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (!editTarget) return;
                      await api.auth.updateAvatar(editTarget.id, null);
                      toast(t('admin.avatarRemoved'), 'success');
                      setEditTarget({ ...editTarget, avatar: null });
                      loadUsers();
                    }}
                  >
                    {t('common.remove')}
                  </Button>
                )}
              </div>
              <input
                ref={avatarFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && editTarget) handleAvatarUpload(f, editTarget.id);
                  e.target.value = '';
                }}
              />
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('admin.displayName')}</label>
              <Input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} placeholder={t('admin.displayNamePlaceholder')} />
            </div>

            {/* Role */}
            {editTarget?.id !== currentUser?.id && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('admin.role')}</label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('admin.pickRole')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{t('admin.roleAdminFull')}</SelectItem>
                    <SelectItem value="user">{t('admin.roleUserFull')}</SelectItem>
                    <SelectItem value="viewer">{t('admin.roleViewerFull')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="secondary" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
              <Button onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog open={showCreateForm} onOpenChange={(open) => { setShowCreateForm(open); if (!open) { setGeneratedPassword(''); setNewAvatarPreview(null); setNewAvatarKey(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.newUser')}</DialogTitle>
          </DialogHeader>
          {!generatedPassword ? (
            <form onSubmit={createUser} className="space-y-4 pt-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('auth.username')}</label>
                <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={t('admin.loginUsername')} required minLength={2} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.displayNameField')}</label>
                <Input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder={t('admin.displayNamePlaceholder')} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('admin.role')}</label>
                <Select value={newUserRole} onValueChange={(v) => setNewUserRole(v as 'user' | 'viewer')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">{t('admin.roleUserFull')}</SelectItem>
                    <SelectItem value="viewer">{t('admin.roleViewerFull')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.optionalAvatar')}</label>
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full overflow-hidden glass-avatar-placeholder flex items-center justify-center flex-shrink-0">
                    {newAvatarPreview ? (
                      <img src={newAvatarPreview} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon size={24} className="text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={avatarUploading}
                      onClick={() => createAvatarFileRef.current?.click()}
                    >
                      {avatarUploading ? t('common.uploading') : newAvatarPreview ? t('common.change') : t('common.selectImage')}
                    </Button>
                    <input
                      ref={createAvatarFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleAvatarUpload(f);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('admin.autoPassword')}</p>
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowCreateForm(false)}>{t('common.cancel')}</Button>
                <Button type="submit" className="flex-1" disabled={creating}>
                  {creating ? t('common.creating') : t('common.create')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="glass-success-panel rounded-lg p-4">
                <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">{t('admin.createdOk')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 glass-code-block px-3 py-2 rounded text-sm font-mono select-all dark:text-gray-100">
                    {generatedPassword}
                  </code>
                  <Button variant="ghost" size="icon" onClick={copyPassword}>
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                  </Button>
                </div>
                <p className="text-xs text-green-600 dark:text-green-400 mt-2">{t('admin.passwordOnce')}</p>
              </div>
              <Button className="w-full" onClick={() => { setGeneratedPassword(''); setShowCreateForm(false); }}>
                {t('admin.confirmSaved')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Password Reset Result Dialog */}
      {generatedPassword && !showCreateForm && (
        <Dialog open={true} onOpenChange={() => setGeneratedPassword('')}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('admin.passwordReset')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="glass-success-panel rounded-lg p-4">
                <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">{t('admin.newPassword')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 glass-code-block px-3 py-2 rounded text-sm font-mono select-all dark:text-gray-100">
                    {generatedPassword}
                  </code>
                  <Button variant="ghost" size="icon" onClick={copyPassword}>
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                  </Button>
                </div>
                <p className="text-xs text-green-600 dark:text-green-400 mt-2">{t('admin.passwordOnce')}</p>
              </div>
              <Button className="w-full" onClick={() => setGeneratedPassword('')}>
                {t('admin.confirmSaved')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

    </div>
    </div>
  );
}
