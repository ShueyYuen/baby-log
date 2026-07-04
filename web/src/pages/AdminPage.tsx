import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import { UserPlus, Trash2, KeyRound, Copy, Check, ShieldCheck, Eye, User as UserIcon, HardDrive } from 'lucide-react';
import { Button, Input, Card, CardContent, Badge, Dialog, DialogContent, DialogHeader, DialogTitle, ConfirmDialog, useToast } from '../components/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui';

interface UserItem {
  id: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
}

export default function AdminPage() {
  const { user: currentUser } = useAuth();
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
  const [roleChangeTarget, setRoleChangeTarget] = useState<UserItem | null>(null);
  const [newRole, setNewRole] = useState('');
  const [cleanupResult, setCleanupResult] = useState<{
    dryRun: boolean;
    s3Total?: number;
    referenced?: number;
    orphanCount?: number;
    orphans?: string[];
    deleted?: number;
    errors?: string[];
  } | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [cacheControlResult, setCacheControlResult] = useState<{
    dryRun: boolean;
    total: number;
    updated?: number;
    skipped?: number;
    errors?: string[];
  } | null>(null);
  const [settingCache, setSettingCache] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const res = await api.get<{ success: boolean; data: UserItem[] }>('/auth/users');
      setUsers(res.data);
    } catch {
      // ignore
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.post<{ success: boolean; data: { generatedPassword: string } }>('/auth/users', {
        username: newUsername,
        displayName: newDisplayName,
        role: newUserRole,
      });
      setGeneratedPassword(res.data.generatedPassword);
      setNewUsername('');
      setNewDisplayName('');
      setNewUserRole('user');
      loadUsers();
    } catch (err: any) {
      toast(err.message || '创建失败', 'error');
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
        await api.delete(`/auth/users/${id}`);
        toast('用户已删除', 'success');
        loadUsers();
      } catch (err: any) {
        toast(err.message || '删除失败', 'error');
      }
    } else {
      try {
        const res = await api.post<{ success: boolean; data: { generatedPassword: string } }>(`/auth/users/${id}/reset-password`, {});
        setGeneratedPassword(res.data.generatedPassword);
      } catch (err: any) {
        toast(err.message || '重置失败', 'error');
      }
    }
  };

  const copyPassword = () => {
    navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleChangeRole = async () => {
    if (!roleChangeTarget || !newRole) return;
    try {
      await api.put(`/auth/users/${roleChangeTarget.id}/role`, { role: newRole });
      toast('角色已更新', 'success');
      setRoleChangeTarget(null);
      loadUsers();
    } catch (err: any) {
      toast(err.message || '更新失败', 'error');
    }
  };

  const runCleanup = async (dryRun: boolean, _all?: boolean) => {
    setCleaningUp(true);
    try {
      const params = dryRun ? '?dry-run=true' : '';
      const res = await api.post<{ success: boolean; data: typeof cleanupResult }>(`/admin/cleanup${params}`, {});
      setCleanupResult(res.data);
      if (!dryRun) {
        toast(`已清理 ${res.data?.deleted ?? 0} 个文件`, 'success');
      }
    } catch (err: any) {
      toast(err.message || '清理失败', 'error');
    } finally {
      setCleaningUp(false);
    }
  };

  const runSetCacheControl = async (dryRun: boolean) => {
    setSettingCache(true);
    try {
      const params = dryRun ? '?dry-run=true' : '';
      const res = await api.post<{ success: boolean; data: typeof cacheControlResult }>(`/admin/s3-cache-control${params}`, {});
      setCacheControlResult(res.data);
      if (!dryRun) {
        toast(`已更新 ${res.data?.updated ?? 0} 个文件的 Cache-Control`, 'success');
      }
    } catch (err: any) {
      toast(err.message || '操作失败', 'error');
    } finally {
      setSettingCache(false);
    }
  };

  const roleBadge = (role: string) => {
    if (role === 'admin') return <Badge variant="info">管理员</Badge>;
    if (role === 'viewer') return <Badge variant="secondary">只读</Badge>;
    return <Badge variant="secondary">普通用户</Badge>;
  };

  const roleIcon = (role: string) => {
    if (role === 'admin') return <ShieldCheck size={14} className="text-blue-500" />;
    if (role === 'viewer') return <Eye size={14} className="text-gray-400" />;
    return <UserIcon size={14} className="text-gray-400" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold dark:text-gray-100">用户管理</h2>
        <Button size="sm" onClick={() => { setShowCreateForm(true); setGeneratedPassword(''); }}>
          <UserPlus size={16} /> 新建用户
        </Button>
      </div>

      <div className="space-y-3">
        {users.map((u) => (
          <Card key={u.id}>
            <CardContent className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium dark:text-gray-100">{u.displayName}</span>
                  {roleBadge(u.role)}
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  @{u.username} · 创建于 {dayjs(u.createdAt).format('YYYY-MM-DD')}
                </p>
              </div>
              {u.id !== currentUser?.id && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setRoleChangeTarget(u); setNewRole(u.role); }}
                    className="p-2 rounded-md text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="更改角色"
                  >
                    {roleIcon(u.role)}
                  </button>
                  <button
                    onClick={() => setConfirmAction({ type: 'reset', id: u.id, name: u.displayName })}
                    className="p-2 rounded-md text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="重置密码"
                  >
                    <KeyRound size={16} />
                  </button>
                  <button
                    onClick={() => setConfirmAction({ type: 'delete', id: u.id, name: u.displayName })}
                    className="p-2 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="删除用户"
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
        title={confirmAction?.type === 'delete' ? '删除用户' : '重置密码'}
        description={
          confirmAction?.type === 'delete'
            ? `确定删除用户"${confirmAction?.name}"？此操作不可撤销。`
            : `确定重置用户"${confirmAction?.name}"的密码？`
        }
        confirmLabel={confirmAction?.type === 'delete' ? '删除' : '重置'}
        variant={confirmAction?.type === 'delete' ? 'danger' : 'default'}
        onConfirm={handleConfirm}
      />

      {/* Change Role Dialog */}
      <Dialog open={!!roleChangeTarget} onOpenChange={(open) => { if (!open) setRoleChangeTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>更改角色 — {roleChangeTarget?.displayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger>
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">管理员（可管理所有用户）</SelectItem>
                <SelectItem value="user">普通用户（可记录宝宝数据）</SelectItem>
                <SelectItem value="viewer">只读用户（仅可查看 + 发朋友圈）</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setRoleChangeTarget(null)}>取消</Button>
              <Button onClick={handleChangeRole}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建用户</DialogTitle>
          </DialogHeader>
          {!generatedPassword ? (
            <form onSubmit={createUser} className="space-y-4 pt-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">用户名</label>
                <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="登录用户名" required minLength={2} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">显示名称</label>
                <Input value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} placeholder="如：爸爸/妈妈/奶奶" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">角色</label>
                <Select value={newUserRole} onValueChange={(v) => setNewUserRole(v as 'user' | 'viewer')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">普通用户（可记录宝宝数据）</SelectItem>
                    <SelectItem value="viewer">只读用户（仅可查看 + 发朋友圈）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">系统将自动生成强密码，创建后请妥善保存。</p>
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowCreateForm(false)}>取消</Button>
                <Button type="submit" className="flex-1" disabled={creating}>
                  {creating ? '创建中...' : '创建'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">用户创建成功！请保存以下密码：</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-gray-800 px-3 py-2 rounded border text-sm font-mono select-all dark:text-gray-100">
                    {generatedPassword}
                  </code>
                  <Button variant="ghost" size="icon" onClick={copyPassword}>
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                  </Button>
                </div>
                <p className="text-xs text-green-600 dark:text-green-400 mt-2">此密码仅显示一次，请立即复制保存！</p>
              </div>
              <Button className="w-full" onClick={() => { setGeneratedPassword(''); setShowCreateForm(false); }}>
                确认已保存
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Storage Cleanup */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <HardDrive size={18} className="text-gray-500" />
            <h2 className="text-xl font-semibold dark:text-gray-100">存储清理</h2>
          </div>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          扫描 S3 存储中的所有文件，对比数据库中的引用关系，找出并清理无引用的孤立文件。同时重建文件追踪表。
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <Button
            size="sm"
            variant="outline"
            disabled={cleaningUp}
            onClick={() => runCleanup(true, false)}
          >
            {cleaningUp ? '扫描中...' : '扫描孤立文件'}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={cleaningUp}
            onClick={() => runCleanup(false, false)}
          >
            执行清理
          </Button>
        </div>

        {cleanupResult && (
          <Card>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div>
                  <p className="text-lg font-bold text-primary-500">{cleanupResult.s3Total ?? 0}</p>
                  <p className="text-xs text-gray-500">S3 文件总数</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-green-500">{cleanupResult.referenced ?? 0}</p>
                  <p className="text-xs text-gray-500">数据库引用</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-red-500">{cleanupResult.orphanCount ?? 0}</p>
                  <p className="text-xs text-gray-500">孤立文件</p>
                </div>
              </div>

              {cleanupResult.dryRun ? (
                cleanupResult.orphans && cleanupResult.orphans.length > 0 && (
                  <div className="max-h-48 overflow-y-auto text-xs space-y-1 mt-2 border-t pt-2 dark:border-gray-700">
                    {cleanupResult.orphans.map((key, i) => (
                      <div key={i} className="flex items-center gap-2 text-gray-500 dark:text-gray-400 font-mono">
                        <span className="text-gray-400 w-6 text-right">{i + 1}.</span>
                        <span className="truncate">{key}</span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <>
                  <p className="text-sm font-medium dark:text-gray-100 mt-2 border-t pt-2 dark:border-gray-700">
                    已删除 <span className="text-green-500 font-bold">{cleanupResult.deleted}</span> / {cleanupResult.orphanCount} 个孤立文件，文件追踪表已重建
                  </p>
                  {cleanupResult.errors && cleanupResult.errors.length > 0 && (
                    <div className="text-xs text-red-500 space-y-0.5">
                      {cleanupResult.errors.map((e, i) => (
                        <p key={i}>{e}</p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* S3 Cache-Control */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-2">
        <div className="flex items-center gap-2 mb-3">
          <HardDrive size={18} className="text-gray-500" />
          <h2 className="text-xl font-semibold dark:text-gray-100">S3 缓存设置</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          为 S3 中所有已上传文件设置 <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded">Cache-Control: public, max-age=31536000, immutable</code>。
          新上传的文件已自动设置，此操作用于更新历史文件。
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          <Button
            size="sm"
            variant="outline"
            disabled={settingCache}
            onClick={() => runSetCacheControl(true)}
          >
            {settingCache ? '扫描中...' : '扫描文件数量'}
          </Button>
          <Button
            size="sm"
            disabled={settingCache}
            onClick={() => runSetCacheControl(false)}
          >
            {settingCache ? '更新中...' : '执行更新'}
          </Button>
        </div>

        {cacheControlResult && (
          <Card>
            <CardContent className="space-y-1">
              <p className="text-sm dark:text-gray-100">
                {cacheControlResult.dryRun ? (
                  <>共 <span className="font-bold text-primary-500">{cacheControlResult.total}</span> 个文件</>
                ) : (
                  <>
                    共 {cacheControlResult.total} 个文件，
                    已更新 <span className="font-bold text-green-500">{cacheControlResult.updated}</span>，
                    跳过 <span className="text-gray-400">{cacheControlResult.skipped}</span>（已是最新）
                  </>
                )}
              </p>
              {cacheControlResult.errors && cacheControlResult.errors.length > 0 && (
                <div className="text-xs text-red-500 space-y-0.5 mt-1">
                  {cacheControlResult.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Password Reset Result Dialog */}
      {generatedPassword && !showCreateForm && (
        <Dialog open={true} onOpenChange={() => setGeneratedPassword('')}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>密码已重置</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">新密码：</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white dark:bg-gray-800 px-3 py-2 rounded border text-sm font-mono select-all dark:text-gray-100">
                    {generatedPassword}
                  </code>
                  <Button variant="ghost" size="icon" onClick={copyPassword}>
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                  </Button>
                </div>
                <p className="text-xs text-green-600 dark:text-green-400 mt-2">此密码仅显示一次，请立即复制保存！</p>
              </div>
              <Button className="w-full" onClick={() => setGeneratedPassword('')}>
                确认已保存
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
