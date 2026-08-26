import dayjs from "dayjs";
import {
  Activity,
  Calendar,
  Camera,
  Home,
  Images,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { ReactNode, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useBaby } from "../contexts/BabyContext";
import { useI18n } from "../contexts/I18nContext";
import { api } from "../lib/api";
import { cropAndResizeAvatar } from "../lib/avatar-crop";
import { formatBabyAge } from "../lib/baby-age";
import { hapticTap } from "../lib/haptic";
import { BabySwitcher } from "./BabySwitcher";
import {
  Button,
  DateTimePicker,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "./ui";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { currentBaby, loading: babyLoading, refreshBabies } = useBaby();
  const { user, logout, isAdmin } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();

  const [showBabyEdit, setShowBabyEdit] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [editName, setEditName] = useState("");
  const [editGender, setEditGender] = useState<string>("male");
  const [editBirthDate, setEditBirthDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(
    null,
  );
  const [editAvatarKey, setEditAvatarKey] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const babyAvatarInputRef = useRef<HTMLInputElement>(null);

  const openBabyEdit = () => {
    if (!currentBaby) return;
    setEditName(currentBaby.name);
    setEditGender(currentBaby.gender);
    setEditBirthDate(
      currentBaby.birthDate
        ? dayjs(currentBaby.birthDate).format("YYYY-MM-DDTHH:mm")
        : "",
    );
    setEditAvatarPreview(currentBaby.avatar ?? null);
    setEditAvatarKey(null);
    setShowBabyEdit(true);
  };

  const handleBabyAvatarUpload = async (file: File) => {
    setAvatarUploading(true);
    try {
      const cropped = await cropAndResizeAvatar(file);
      const formData = new FormData();
      formData.append("file", cropped);
      const res = await api.post<{
        success: boolean;
        data: { url: string; key: string };
      }>("/upload", formData);
      setEditAvatarPreview(res.data.url);
      setEditAvatarKey(res.data.key);
    } catch {
      toast(t("baby.avatarUploadFailed"), "error");
    } finally {
      setAvatarUploading(false);
    }
  };

  const saveBabyEdit = async () => {
    if (!currentBaby || !editName.trim()) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: editName.trim(),
        gender: editGender,
        birthDate: editBirthDate
          ? new Date(editBirthDate).toISOString()
          : undefined,
      };
      if (editAvatarKey) payload.avatar = editAvatarKey;
      await api.babies.update(currentBaby.id, payload);
      await refreshBabies();
      setShowBabyEdit(false);
    } catch {
      toast(t("baby.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const isSecondaryPage =
    /^\/(record|plan\/new|plan\/[^/]+\/edit|growth\/history|health\/[^/]+|milk-inventory|medical-visits\/|stats)/.test(
      location.pathname,
    );

  const mobileNav = [
    { path: "/", icon: Home, label: t("nav.records") },
    { path: "/plans", icon: Calendar, label: t("nav.plans") },
    { path: "/growth", icon: TrendingUp, label: t("nav.growth") },
    { path: "/moments", icon: Images, label: t("nav.moments") },
    { path: "/me", icon: User, label: t("nav.me") },
  ];

  const desktopNav = [
    { path: "/", icon: Home, label: t("nav.records") },
    { path: "/plans", icon: Calendar, label: t("nav.plans") },
    { path: "/growth", icon: TrendingUp, label: t("nav.growth") },
    { path: "/moments", icon: Images, label: t("nav.moments") },
    { path: "/me", icon: User, label: t("nav.me") },
    { path: "/health", icon: Activity, label: t("nav.health") },
    ...(isAdmin
      ? [{ path: "/admin", icon: Users, label: t("nav.admin") }]
      : []),
  ];

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return (
      location.pathname === path || location.pathname.startsWith(path + "/")
    );
  };

  const babyAge = formatBabyAge(currentBaby?.birthDate, t);
  const babyNameLabel = babyLoading ? "…" : currentBaby?.name;

  const babyButton = (size: "sm" | "md") =>
    currentBaby ? (
      <button
        onClick={() => setShowSwitcher(true)}
        className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors text-left"
      >
        {currentBaby.avatar ? (
          <img
            src={currentBaby.avatar}
            alt=""
            className={`${size === "md" ? "w-7 h-7" : "w-6 h-6"} rounded-full object-cover flex-shrink-0`}
          />
        ) : (
          <span
            className={`${size === "md" ? "w-7 h-7 text-xs" : "w-6 h-6 text-[10px]"} rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-600 font-medium flex items-center justify-center flex-shrink-0`}
          >
            {currentBaby.name.slice(0, 1)}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate">{babyNameLabel}</span>
          {babyAge && (
            <span className="block text-[11px] text-gray-400 leading-tight">
              {babyAge}
            </span>
          )}
        </span>
      </button>
    ) : babyLoading ? (
      <span className="text-sm text-gray-400">…</span>
    ) : (
      <Link
        to="/baby/setup"
        className="text-sm text-primary-500 hover:text-primary-600"
      >
        {t("baby.add")}
      </Link>
    );

  const renderNav = (items: typeof desktopNav, variant: "side" | "bottom") =>
    items.map((item) => {
      const active = isActive(item.path);
      if (variant === "side") {
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`glass-nav-item flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
              active
                ? "bg-primary-50 text-primary-600 glass-nav-item-active"
                : "text-gray-600 dark:text-gray-300 hover:bg-white/40"
            }`}
          >
            <item.icon size={20} />
            <span className="font-medium">{item.label}</span>
          </Link>
        );
      }
      return (
        <Link
          key={item.path}
          to={item.path}
          onClick={hapticTap}
          className={`flex-1 flex flex-col items-center py-2.5 transition-transform active:scale-90 ${
            active ? "text-primary-500" : "text-gray-400 dark:text-gray-500"
          }`}
        >
          <item.icon size={22} />
          <span className="text-[11px] mt-1 font-medium">{item.label}</span>
        </Link>
      );
    });

  return (
    <div className="h-screen overflow-hidden bg-transparent md:pl-64">
      <div className="glass-ambient-orbs" aria-hidden="true">
        <div className="glass-ambient-orb glass-ambient-orb-1" />
        <div className="glass-ambient-orb glass-ambient-orb-2" />
        <div className="glass-ambient-orb glass-ambient-orb-3" />
        <div className="glass-ambient-orb glass-ambient-orb-4" />
      </div>

      <aside className="glass-sidebar hidden md:flex fixed left-0 top-0 h-full w-64 border-r glass-divider flex-col z-50">
        <div className="p-6 border-b glass-divider">
          <h1 className="text-xl font-bold text-primary-600">
            {t("app.name")}
          </h1>
          <div className="mt-1.5">{babyButton("md")}</div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {renderNav(desktopNav.slice(0, 5), "side")}
          <div className="h-px bg-gray-200/60 dark:bg-white/10 my-3" />
          {renderNav(desktopNav.slice(5), "side")}
        </nav>

        <div className="p-4 border-t glass-divider">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {user?.displayName}
            </span>
            <button
              onClick={logout}
              className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              {t("auth.logout")}
            </button>
          </div>
        </div>
      </aside>

      <header
        className={`glass-topbar md:hidden fixed top-0 left-0 right-0 border-b glass-divider z-50 px-4 py-3 flex items-center justify-between ${isSecondaryPage ? "hidden" : ""}`}
      >
        <h1 className="text-lg font-bold text-primary-600">{t("app.name")}</h1>
        {babyButton("sm")}
      </header>

      <main className="h-full overflow-hidden glass-main-area">{children}</main>

      <nav
        className={`glass-bottomnav md:hidden fixed bottom-0 left-0 right-0 border-t glass-divider z-50 flex ${isSecondaryPage ? "hidden" : ""}`}
      >
        {renderNav(mobileNav, "bottom")}
      </nav>

      <BabySwitcher
        open={showSwitcher}
        onOpenChange={setShowSwitcher}
        onEditCurrent={openBabyEdit}
      />

      <Dialog open={showBabyEdit} onOpenChange={setShowBabyEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("baby.edit")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("baby.avatar")}
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => babyAvatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="relative w-16 h-16 rounded-full overflow-hidden glass-avatar-placeholder flex items-center justify-center flex-shrink-0"
                >
                  {editAvatarPreview ? (
                    <img
                      src={editAvatarPreview}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Camera size={22} className="text-gray-400" />
                  )}
                </button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={avatarUploading}
                  onClick={() => babyAvatarInputRef.current?.click()}
                >
                  {avatarUploading
                    ? t("common.uploading")
                    : editAvatarPreview
                      ? t("common.changeAvatar")
                      : t("common.selectImage")}
                </Button>
                <input
                  ref={babyAvatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleBabyAvatarUpload(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("baby.name")}
              </label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={t("baby.namePlaceholder")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("common.gender")}
              </label>
              <Select value={editGender} onValueChange={setEditGender}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{t("common.male")}</SelectItem>
                  <SelectItem value="female">{t("common.female")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t("common.birthDate")}
              </label>
              <DateTimePicker
                value={editBirthDate}
                onChange={(v) => setEditBirthDate(v)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={() => setShowBabyEdit(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={saveBabyEdit}
                disabled={saving || !editName.trim()}
              >
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
