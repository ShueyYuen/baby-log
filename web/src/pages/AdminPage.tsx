import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import { UserPlus, Trash2, KeyRound, Copy, Check, ShieldCheck, Eye, User as UserIcon } from 'lucide-react';
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
