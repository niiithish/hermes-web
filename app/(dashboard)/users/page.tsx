'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/app/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RiSettings3Line, RiDeleteBinLine, RiEyeLine, RiEyeOffLine } from '@remixicon/react';

const ALL_PERMISSIONS = [
  'chat.use', 'chat.configure', 'chat.clear',
  'agents.manage', 'agents.configure',
  'skills.manage', 'logs.view', 'maintenance.use',
  'files.read', 'files.write', 'admin.access', 'admin.users',
  'api.access', 'terminal.use', 'terminal.configure', 'system.manage',
  'gateway.manage', 'cron.manage', 'usage.view', 'usage.detailed',
  'mon.view', 'settings.read', 'settings.write',
] as const;
type Permission = (typeof ALL_PERMISSIONS)[number];

const PERMISSION_CATEGORIES: { label: string; perms: Permission[] }[] = [
  { label: 'Chat', perms: ['chat.use', 'chat.configure', 'chat.clear'] },
  { label: 'Agents', perms: ['agents.manage', 'agents.configure'] },
  { label: 'Skills', perms: ['skills.manage'] },
  { label: 'Logs', perms: ['logs.view'] },
  { label: 'Maintenance', perms: ['maintenance.use'] },
  { label: 'Files', perms: ['files.read', 'files.write'] },
  { label: 'Admin', perms: ['admin.access', 'admin.users'] },
  { label: 'API', perms: ['api.access'] },
  { label: 'Terminal', perms: ['terminal.use', 'terminal.configure'] },
  { label: 'System', perms: ['system.manage'] },
  { label: 'Gateway', perms: ['gateway.manage'] },
  { label: 'Cron', perms: ['cron.manage'] },
  { label: 'Usage', perms: ['usage.view', 'usage.detailed'] },
  { label: 'Monitor', perms: ['mon.view'] },
  { label: 'Settings', perms: ['settings.read', 'settings.write'] },
];

const ROLE_PRESETS: Record<string, Partial<Record<Permission, boolean>>> = {
  admin: Object.fromEntries(ALL_PERMISSIONS.map(p => [p, true])) as Record<Permission, boolean>,
  viewer: { 'chat.use': true, 'logs.view': true, 'files.read': true, 'usage.view': true, 'mon.view': true, 'settings.read': true },
  custom: {},
};

interface User {
  username: string;
  role: string;
  permissions?: Record<string, boolean>;
  last_login: string | null;
  created_at: string;
}

interface AuditEntry {
  timestamp: string;
  username: string;
  role: string;
  action: string;
  details: string;
}

function parseAuditLine(line: string): AuditEntry | null {
  const m = line.match(/^\[([^\]]+)\] \[([^\]]+)\] \[([^\]]+)\] (\S+):\s*(.*)$/);
  if (!m) return null;
  return { timestamp: m[1], username: m[2], role: m[3], action: m[4], details: m[5] || '' };
}

function auditColor(action: string): string {
  switch (action) {
    case 'LOGIN': case 'SETUP': return 'text-green-600';
    case 'LOGIN_FAILED': case 'DENIED': case 'SESSION_DELETE': case 'USER_DELETE': case 'PROFILE_DELETE': case 'KEY_DELETE': case 'LOGOUT': return 'text-red-600';
    case 'USER_CREATE': case 'RESET_PASSWORD': case 'CHANGE_PASSWORD': case 'PROFILE_CREATE': case 'BACKUP_CREATE': return 'text-blue-600';
    case 'CONFIG_UPDATE': case 'KEY_REVEAL': case 'KEY_UPDATE': case 'HERMES_UPDATE': case 'HCI_RESTART': case 'BACKUP_IMPORT': return 'text-amber-600';
    default: return 'text-muted-foreground';
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function formatDateShort(iso: string | null): string {
  if (!iso) return 'Never';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function countPermissions(permissions?: Record<string, boolean>): number {
  return permissions ? Object.values(permissions).filter(Boolean).length : 0;
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [auditEntries, setAuditEntries] = useState<string[]>([]);
  const [auditLimit, setAuditLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(true);
  const [error, setError] = useState('');

  // Create
  const [showCreate, setShowCreate] = useState(false);
  const [createUsername, setCreateUsername] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [createRole, setCreateRole] = useState<'admin'|'viewer'|'custom'>('viewer');
  const [createPerms, setCreatePerms] = useState<Record<string,boolean>>({});
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');

  // Edit
  const [showEdit, setShowEdit] = useState(false);
  const [editUser, setEditUser] = useState<User|null>(null);
  const [editRole, setEditRole] = useState<'admin'|'viewer'|'custom'>('viewer');
  const [editPerms, setEditPerms] = useState<Record<string,boolean>>({});
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState('');
  const [showResetPwd, setShowResetPwd] = useState(false);
  const [resetNewPwd, setResetNewPwd] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState('');

  // Delete
  const [showDelete, setShowDelete] = useState(false);
  const [deleteUser, setDeleteUser] = useState<User|null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [toast, setToast] = useState<{message:string;type:'success'|'error'}|null>(null);
  const showToast = useCallback((message:string, type:'success'|'error') => {
    setToast({message,type}); setTimeout(()=>setToast(null),3500);
  },[]);

  const fetchUsers = useCallback(async () => {
    try {
      const data = await api.getUsers();
      if (data.ok) setUsers(data.users as User[]);
      else setError((data as {error?:string}).error || 'Failed');
    } catch(err){if(err instanceof Error&&(err as {status?:number}).status===403){router.push('/');return;}setError(err instanceof Error?err.message:'Failed');}
    finally{setLoading(false);}
  },[router]);

  const fetchAudit = useCallback(async (limit:number) => {
    setAuditLoading(true);
    try{const data=await api.get<{ok:boolean;entries:string[]}>(`/api/audit?limit=${limit}`);if(data.ok)setAuditEntries(data.entries);}
    catch{}finally{setAuditLoading(false);}
  },[]);

  useEffect(()=>{fetchUsers();fetchAudit(auditLimit);},[]);//eslint-disable-line

  const openCreate = () => {
    setCreateUsername('');setCreatePassword('');setShowPassword(false);setCreateRole('viewer');
    setCreatePerms({...ROLE_PRESETS.viewer});setCreateError('');setShowCreate(true);
  };
  const setCreateRoleWithPreset = (role:'admin'|'viewer'|'custom') => {setCreateRole(role);if(role!=='custom')setCreatePerms({...ROLE_PRESETS[role]});};

  const handleCreate = async (e:React.FormEvent) => {
    e.preventDefault();setCreateError('');
    if(!createUsername.trim()){setCreateError('Username required');return;}
    if(createPassword.length<8){setCreateError('Password min 8 chars');return;}
    setCreateSubmitting(true);
    try{
      const perms = createRole==='custom'?createPerms:undefined;
      const data = await api.createUser(createUsername.trim(),createPassword,createRole,perms);
      if(data.ok){setShowCreate(false);showToast(`User "${createUsername.trim()}" created`,'success');await fetchUsers();fetchAudit(auditLimit);}
      else setCreateError((data as {error?:string}).error||'Failed');
    }catch(err){setCreateError(err instanceof Error?err.message:'Failed');}
    finally{setCreateSubmitting(false);}
  };

  const openEdit = (user:User) => {
    setEditUser(user);
    const role = (['admin','viewer','custom'].includes(user.role)?user.role:'viewer') as 'admin'|'viewer'|'custom';
    setEditRole(role);setEditPerms(user.permissions?{...user.permissions}:{...ROLE_PRESETS[role]});
    setEditError('');setShowResetPwd(false);setResetNewPwd('');setResetError('');setShowEdit(true);
  };
  const setEditRoleWithPreset = (role:'admin'|'viewer'|'custom') => {setEditRole(role);if(role!=='custom')setEditPerms({...ROLE_PRESETS[role]});};

  const handleEditSave = async (e:React.FormEvent) => {
    e.preventDefault();setEditError('');if(!editUser)return;
    setEditSubmitting(true);
    try{
      const perms = editRole==='custom'?editPerms:undefined;
      const data = await api.updateUser(editUser.username,editRole,perms);
      if(data.ok){setShowEdit(false);showToast(`User "${editUser.username}" updated`,'success');await fetchUsers();fetchAudit(auditLimit);}
      else setEditError((data as {error?:string}).error||'Failed');
    }catch(err){setEditError(err instanceof Error?err.message:'Failed');}
    finally{setEditSubmitting(false);}
  };

  const handleResetPassword = async () => {
    if(!editUser)return;setResetError('');
    if(resetNewPwd.length<8){setResetError('Min 8 chars');return;}
    setResetSubmitting(true);
    try{
      const data = await api.post<{ok:boolean;error?:string}>(`/api/users/${encodeURIComponent(editUser.username)}/reset-password`,{new_password:resetNewPwd});
      if(data.ok){showToast(`Password reset for "${editUser.username}"`,'success');setShowResetPwd(false);setResetNewPwd('');}
      else setResetError(data.error||'Failed');
    }catch(err){setResetError(err instanceof Error?err.message:'Failed');}
    finally{setResetSubmitting(false);}
  };

  const openDelete = (user:User) => {setDeleteUser(user);setShowDelete(true);};
  const handleDelete = async () => {
    if(!deleteUser)return;setDeleteSubmitting(true);
    try{
      const data = await api.deleteUser(deleteUser.username);
      if(data.ok){setShowDelete(false);setDeleteUser(null);showToast(`User "${deleteUser.username}" deleted`,'success');await fetchUsers();fetchAudit(auditLimit);}
      else showToast((data as {error?:string}).error||'Failed','error');
    }catch(err){showToast(err instanceof Error?err.message:'Failed','error');}
    finally{setDeleteSubmitting(false);}
  };

  const renderPerms = (perms:Record<string,boolean>,role:string,onToggle?:(p:string)=>void) => (
    <div className="space-y-3">
      {PERMISSION_CATEGORIES.map(cat => (
        <div key={cat.label}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{cat.label}</p>
          <div className="flex flex-wrap gap-1">
            {cat.perms.map(perm => (
              <label key={perm} className={`flex items-center gap-1.5 text-xs px-1.5 py-0.5 rounded cursor-pointer select-none ${role==='custom'?'':'opacity-70 cursor-default'}`}>
                <input type="checkbox" className="accent-accent cursor-pointer m-0" checked={!!perms[perm]} disabled={role!=='custom'} onChange={()=>onToggle?.(perm)} />
                {perm}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Users */}
      <div className="flex-1 basis-[60%] flex flex-col p-6 overflow-y-auto border-r">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-bold">User Management</h1>
          <Button onClick={openCreate}>+ Create User</Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">Manage user accounts and permissions</p>
        {error && <p className="text-destructive text-sm mb-3">{error}</p>}
        {loading ? <div className="text-muted-foreground">Loading users...</div> : (
          <div className="flex flex-col gap-1.5 flex-1">
            {users.map(u => (
              <div key={u.username} className="flex items-center justify-between bg-secondary/30 border rounded-lg px-3 py-2.5 gap-3">
                <div className="flex flex-col min-w-0">
                  <span className="font-medium text-sm truncate">{u.username}</span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    <Badge variant={u.role==='admin'?'default':'secondary'} className="text-[10px] px-1.5 py-0">{u.role}</Badge>
                    {' '}&middot; {countPermissions(u.permissions)} perms &middot; Last: {formatDateShort(u.last_login)}
                  </span>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={()=>openEdit(u)}><RiSettings3Line className="h-4 w-4"/></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={()=>openDelete(u)}><RiDeleteBinLine className="h-4 w-4"/></Button>
                </div>
              </div>
            ))}
            {users.length===0 && <div className="flex items-center justify-center py-10 text-muted-foreground">No users found</div>}
          </div>
        )}
      </div>

      {/* Right: Audit */}
      <div className="flex-1 basis-[40%] flex flex-col p-6 overflow-y-auto">
        <h1 className="text-xl font-bold">Audit Log</h1>
        <p className="text-sm text-muted-foreground mb-4">Recent security-relevant events</p>
        {auditLoading&&auditEntries.length===0 ? <div className="text-muted-foreground">Loading...</div> : (
          <div className="flex-1 overflow-y-auto space-y-0.5">
            {auditEntries.map((line,i)=>{
              const e=parseAuditLine(line);
              if(!e) return <div key={i} className="text-[11px] text-muted-foreground py-0.5">{line}</div>;
              const c=auditColor(e.action);const bc=c.replace('text-','border-');
              return (
                <div key={i} className={`text-[11px] px-2 py-1.5 rounded bg-secondary/30 border-l-[3px] ${bc} leading-relaxed break-all`}>
                  <span className="text-muted-foreground/70 mr-1">{new Date(e.timestamp).toLocaleString()}</span>
                  <span className={`font-semibold ${c}`}>{e.action}</span>
                  {' '}<span className="text-muted-foreground">{e.username}</span>
                  {e.details&&<span className="text-muted-foreground/60"> — {e.details}</span>}
                </div>
              );
            })}
            {auditEntries.length===0&&!auditLoading&&<div className="text-center py-10 text-muted-foreground">No entries</div>}
            {auditEntries.length>=auditLimit&&(
              <Button variant="ghost" size="sm" className="w-full mt-2" onClick={()=>{const n=auditLimit+50;setAuditLimit(n);fetchAudit(n);}} disabled={auditLoading}>
                {auditLoading?'Loading...':'Load more'}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create User</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><label className="text-xs text-muted-foreground font-medium">Username</label>
              <Input value={createUsername} onChange={e=>setCreateUsername(e.target.value)} placeholder="Username" autoComplete="off" autoFocus /></div>
            <div><label className="text-xs text-muted-foreground font-medium">Password</label>
              <div className="flex gap-1"><Input type={showPassword?'text':'password'} value={createPassword} onChange={e=>setCreatePassword(e.target.value)} placeholder="Min 8 chars" autoComplete="new-password"/>
                <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={()=>setShowPassword(!showPassword)}>
                  {showPassword?<RiEyeOffLine className="h-4 w-4"/>:<RiEyeLine className="h-4 w-4"/>}</Button></div></div>
            <div><label className="text-xs text-muted-foreground font-medium">Role</label>
              <ToggleGroup value={createRole ? [createRole] : undefined} onValueChange={(v) => { if (v && v.length > 0) setCreateRoleWithPreset(v[0] as 'admin'|'viewer'|'custom'); }}>
                {(['admin','viewer','custom']as const).map(r=><ToggleGroupItem key={r} value={r} className="text-xs">{r.charAt(0).toUpperCase()+r.slice(1)}</ToggleGroupItem>)}
              </ToggleGroup></div>
            <div><label className="text-xs text-muted-foreground font-medium">Permissions{createRole!=='custom'&&' (set by role)'}</label>
              {renderPerms(createPerms,createRole,p=>{if(createRole==='custom')setCreatePerms(prev=>({...prev,[p]:!prev[p]}));})}</div>
            {createError&&<p className="text-destructive text-xs">{createError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={()=>setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={createSubmitting}>{createSubmitting?'Creating...':'Create'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit: {editUser?.username}</DialogTitle></DialogHeader>
          <form onSubmit={handleEditSave} className="space-y-3">
            <div><label className="text-xs text-muted-foreground font-medium">Role</label>
              <ToggleGroup value={editRole ? [editRole] : undefined} onValueChange={(v) => { if (v && v.length > 0) setEditRoleWithPreset(v[0] as 'admin'|'viewer'|'custom'); }}>
                {(['admin','viewer','custom']as const).map(r=><ToggleGroupItem key={r} value={r} className="text-xs">{r.charAt(0).toUpperCase()+r.slice(1)}</ToggleGroupItem>)}
              </ToggleGroup></div>
            <div><label className="text-xs text-muted-foreground font-medium">Permissions{editRole!=='custom'&&' (set by role)'}</label>
              {renderPerms(editPerms,editRole,p=>{if(editRole==='custom')setEditPerms(prev=>({...prev,[p]:!prev[p]}));})}</div>
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between"><span className="text-sm font-semibold">Reset Password</span>
                <Button type="button" variant="ghost" size="sm" onClick={()=>setShowResetPwd(!showResetPwd)}>{showResetPwd?'Cancel':'Reset'}</Button></div>
              {showResetPwd&&<div className="flex gap-1"><Input type="password" value={resetNewPwd} onChange={e=>setResetNewPwd(e.target.value)} placeholder="New password (min 8)" autoComplete="new-password"/>
                <Button type="button" variant="outline" size="sm" onClick={handleResetPassword} disabled={resetSubmitting}>{resetSubmitting?'Resetting...':'Reset'}</Button></div>}
              {resetError&&<p className="text-destructive text-[11px]">{resetError}</p>}
            </div>
            {editError&&<p className="text-destructive text-xs">{editError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={()=>setShowEdit(false)}>Cancel</Button>
              <Button type="submit" disabled={editSubmitting}>{editSubmitting?'Saving...':'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete User</DialogTitle>
            <DialogDescription>Are you sure you want to delete <strong>{deleteUser?.username}</strong>? This cannot be undone.</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteSubmitting}>{deleteSubmitting?'Deleting...':'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <div className={`fixed top-[60px] right-6 z-50 px-4 py-2.5 rounded-lg text-sm font-medium border ${
          toast.type==='success'?'bg-green-950/20 border-green-500 text-green-400':'bg-red-950/20 border-red-500 text-red-400'}`}>{toast.message}</div>
      )}
    </div>
  );
}
