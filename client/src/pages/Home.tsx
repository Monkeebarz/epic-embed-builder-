import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, LogOut, Save, Send, Trash2, Users } from "lucide-react";
import { EPIC_LOGO_PATH } from "@shared/const";
import { chicagoLocalToUtcMs, utcMsToChicagoLocal, formatChicago } from "@shared/timezone";

type FormState = {
  title: string;
  description: string;
  color: string;
  thumbnailUrl: string;
  imageUrl: string;
  footerText: string;
  eventTimeLocal: string;   // CDT datetime-local string
  channelId: string;
  rolePingIds: string[];
  rsvpEnabled: boolean;
  maxAttendees: string;
  rsvpDeadlineLocal: string; // CDT datetime-local string
  dmMessage: string;
  gameLink: string;
  autoAssignRoleId: string;
  remind1h: boolean;
  remind10m: boolean;
  remindAtStart: boolean;
};

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  color: "#6A0DAD",
  thumbnailUrl: "",
  imageUrl: "",
  footerText: "",
  eventTimeLocal: "",
  channelId: "",
  rolePingIds: [],
  rsvpEnabled: false,
  maxAttendees: "",
  rsvpDeadlineLocal: "",
  dmMessage: "",
  gameLink: "",
  autoAssignRoleId: "",
  remind1h: true,
  remind10m: true,
  remindAtStart: true,
};

const NONE = "__none__";

function formToPayload(f: FormState) {
  return {
    title: f.title,
    description: f.description || null,
    color: f.color,
    thumbnailUrl: f.thumbnailUrl || null,
    imageUrl: f.imageUrl || null,
    footerText: f.footerText || null,
    eventTimeUtc: f.eventTimeLocal ? chicagoLocalToUtcMs(f.eventTimeLocal) : null,
    channelId: f.channelId || null,
    rolePingIds: f.rolePingIds,
    rsvpEnabled: f.rsvpEnabled,
    maxAttendees: f.maxAttendees ? Math.max(1, parseInt(f.maxAttendees, 10) || 0) : null,
    rsvpDeadlineUtc: f.rsvpDeadlineLocal ? chicagoLocalToUtcMs(f.rsvpDeadlineLocal) : null,
    dmMessage: f.dmMessage || null,
    gameLink: f.gameLink || null,
    autoAssignRoleId: f.autoAssignRoleId && f.autoAssignRoleId !== NONE ? f.autoAssignRoleId : null,
    remind1h: f.remind1h,
    remind10m: f.remind10m,
    remindAtStart: f.remindAtStart,
  };
}

const inputCls =
  "bg-[#0a0a0f] border-[#d4af37]/40 text-[#e8d48b] placeholder:text-[#d4af37]/30";
const labelCls = "text-[#d4af37] text-xs tracking-wider uppercase";

export default function Home({ onLogout }: { onLogout?: () => Promise<void> | void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saveOpen, setSaveOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [attendeesFor, setAttendeesFor] = useState<number | null>(null);

  const utils = trpc.useUtils();
  const channelsQ = trpc.embed.discord.channels.useQuery(undefined, { staleTime: 60_000 });
  const rolesQ = trpc.embed.discord.roles.useQuery(undefined, { staleTime: 60_000 });
  const templatesQ = trpc.embed.templates.list.useQuery();
  const eventsQ = trpc.embed.events.list.useQuery();
  const attendeesQ = trpc.embed.events.attendees.useQuery(
    { eventId: attendeesFor ?? 0 },
    { enabled: attendeesFor !== null },
  );

  const saveMut = trpc.embed.templates.save.useMutation({
    onSuccess: () => {
      toast.success("Template saved");
      setSaveOpen(false);
      void utils.embed.templates.list.invalidate();
    },
    onError: e => toast.error(`Save failed: ${e.message}`),
  });
  const deleteMut = trpc.embed.templates.delete.useMutation({
    onSuccess: () => {
      toast.success("Template deleted");
      setDeleteTarget(null);
      void utils.embed.templates.list.invalidate();
    },
    onError: e => toast.error(`Delete failed: ${e.message}`),
  });
  const sendMut = trpc.embed.send.useMutation({
    onSuccess: res => {
      toast.success(
        res.eventId
          ? `Embed sent! RSVP tracking active${res.reminderScheduled ? " + reminders scheduled" : ""}.`
          : "Embed sent!",
      );
      void utils.embed.events.list.invalidate();
    },
    onError: e => toast.error(`Send failed: ${e.message}`),
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const loadTemplate = (idStr: string) => {
    const t = templatesQ.data?.find(t => String(t.id) === idStr);
    if (!t) return;
    setForm({
      title: t.title ?? "",
      description: t.description ?? "",
      color: t.color ?? "#6A0DAD",
      thumbnailUrl: t.thumbnail_url ?? "",
      imageUrl: t.image_url ?? "",
      footerText: t.footer_text ?? "",
      eventTimeLocal: t.event_time_utc ? utcMsToChicagoLocal(Number(t.event_time_utc)) : "",
      channelId: t.channel_id ?? "",
      rolePingIds: (() => {
        try { return JSON.parse(t.role_ping_ids ?? "[]") as string[]; }
        catch { return []; }
      })(),
      rsvpEnabled: !!t.rsvp_enabled,
      maxAttendees: t.max_attendees ? String(t.max_attendees) : "",
      rsvpDeadlineLocal: t.rsvp_deadline_utc ? utcMsToChicagoLocal(Number(t.rsvp_deadline_utc)) : "",
      dmMessage: t.dm_message ?? "",
      gameLink: t.game_link ?? "",
      autoAssignRoleId: t.auto_assign_role_id ?? "",
      remind1h: !!t.remind_1h,
      remind10m: !!t.remind_10m,
      remindAtStart: !!t.remind_at_start,
    });
    toast.success(`Loaded template "${t.name}"`);
  };

  const previewTime = useMemo(
    () => (form.eventTimeLocal ? chicagoLocalToUtcMs(form.eventTimeLocal) : null),
    [form.eventTimeLocal],
  );
  const previewDeadline = useMemo(
    () => (form.rsvpDeadlineLocal ? chicagoLocalToUtcMs(form.rsvpDeadlineLocal) : null),
    [form.rsvpDeadlineLocal],
  );
  const pingRoles = (rolesQ.data ?? []).filter(r => form.rolePingIds.includes(r.id));

  const canSend = form.channelId && (form.title || form.description) && !sendMut.isPending;

  return (
    <div className="min-h-screen bg-[#0a0a0f] pb-16">
      {/* Header */}
      <header className="border-b border-[#d4af37]/30 bg-[#0d0d14] sticky top-0 z-20">
        <div className="container flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <img
              src={EPIC_LOGO_PATH}
              alt="EPIC Embed"
              className="w-10 h-10 rounded border border-[#d4af37]/50 object-cover"
            />
            <div>
              <h1 className="text-lg font-bold text-[#d4af37] gold-glow tracking-widest leading-tight">
                EPIC EMBED BUILDER
              </h1>
              <p className="text-[10px] text-[#d4af37]/50 tracking-widest uppercase">
                Elite Poker Inner Circle
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-[#d4af37]/50 text-[#d4af37] hover:bg-[#6A0DAD]/30"
            onClick={() => void onLogout?.()}>
            <LogOut className="w-4 h-4 mr-1" /> Exit
          </Button>
        </div>
      </header>

      <main className="container mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ============ FORM COLUMN ============ */}
        <div className="space-y-6">
          {/* Templates */}
          <Card className="bg-[#12121a] border-[#d4af37]/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-[#d4af37] text-sm tracking-widest uppercase">
                📜 Templates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <Select onValueChange={loadTemplate}>
                  <SelectTrigger className={`flex-1 ${inputCls}`}>
                    <SelectValue placeholder={templatesQ.isLoading ? "Loading..." : "Load a template..."} />
                  </SelectTrigger>
                  <SelectContent className="bg-[#12121a] border-[#d4af37]/40">
                    {(templatesQ.data ?? []).map(t => (
                      <SelectItem key={t.id} value={String(t.id)} className="text-[#e8d48b]">
                        {t.name}
                      </SelectItem>
                    ))}
                    {templatesQ.data?.length === 0 && (
                      <div className="px-3 py-2 text-xs text-[#d4af37]/50">No templates saved yet</div>
                    )}
                  </SelectContent>
                </Select>
                <Button className="epic-btn" onClick={() => setSaveOpen(true)}>
                  <Save className="w-4 h-4 mr-1" /> Save as Template
                </Button>
              </div>
              {(templatesQ.data ?? []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {(templatesQ.data ?? []).map(t => (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1 text-xs border border-[#d4af37]/40 rounded px-2 py-1 text-[#e8d48b] bg-[#0a0a0f]">
                      {t.name}
                      <button
                        aria-label={`Delete ${t.name}`}
                        onClick={() => setDeleteTarget({ id: t.id, name: t.name })}
                        className="text-red-400/80 hover:text-red-400 ml-1">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Embed fields */}
          <Card className="bg-[#12121a] border-[#d4af37]/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-[#d4af37] text-sm tracking-widest uppercase">
                ⚜️ Embed Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className={labelCls}>Title</Label>
                <Input className={inputCls} value={form.title}
                  onChange={e => set("title", e.target.value)} placeholder="Friday Night Poker" />
              </div>
              <div>
                <Label className={labelCls}>Description</Label>
                <Textarea className={`${inputCls} min-h-24`} value={form.description}
                  onChange={e => set("description", e.target.value)}
                  placeholder="The Circle convenes. Bring your chips and your courage..." />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className={labelCls}>Color</Label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : "#6A0DAD"}
                      onChange={e => set("color", e.target.value)}
                      className="w-10 h-9 rounded border border-[#d4af37]/40 bg-transparent p-0.5"
                    />
                    <Input className={inputCls} value={form.color}
                      onChange={e => set("color", e.target.value)} placeholder="#6A0DAD" />
                  </div>
                </div>
                <div>
                  <Label className={labelCls}>Event Time (CDT)</Label>
                  <Input type="datetime-local" className={inputCls} value={form.eventTimeLocal}
                    onChange={e => set("eventTimeLocal", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className={labelCls}>Thumbnail URL</Label>
                  <Input className={inputCls} value={form.thumbnailUrl}
                    onChange={e => set("thumbnailUrl", e.target.value)} placeholder="https://..." />
                </div>
                <div>
                  <Label className={labelCls}>Image URL</Label>
                  <Input className={inputCls} value={form.imageUrl}
                    onChange={e => set("imageUrl", e.target.value)} placeholder="https://..." />
                </div>
              </div>
              <div>
                <Label className={labelCls}>Footer Text</Label>
                <Input className={inputCls} value={form.footerText}
                  onChange={e => set("footerText", e.target.value)} placeholder="E.P.I.C. — Trust the Eye" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className={labelCls}>Channel</Label>
                  <Select value={form.channelId || undefined} onValueChange={v => set("channelId", v)}>
                    <SelectTrigger className={inputCls}>
                      <SelectValue placeholder={channelsQ.isLoading ? "Loading channels..." : "Select channel"} />
                    </SelectTrigger>
                    <SelectContent className="bg-[#12121a] border-[#d4af37]/40">
                      {(channelsQ.data ?? []).map(ch => (
                        <SelectItem key={ch.id} value={ch.id} className="text-[#e8d48b]">
                          #{ch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className={labelCls}>Role Ping</Label>
                  {/* Multi-select role ping: click to toggle each role */}
                  <div className="border border-[#d4af37]/40 rounded bg-[#0a0a0f] p-2 max-h-40 overflow-y-auto space-y-1">
                    {rolesQ.isLoading ? (
                      <div className="text-xs text-[#d4af37]/50 px-1">Loading roles...</div>
                    ) : (rolesQ.data ?? []).length === 0 ? (
                      <div className="text-xs text-[#d4af37]/50 px-1">No roles found</div>
                    ) : (
                      (rolesQ.data ?? []).map(r => {
                        const checked = form.rolePingIds.includes(r.id);
                        return (
                          <label key={r.id}
                            className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-sm transition-colors ${checked ? "bg-[#6A0DAD]/30 text-[#e8d48b]" : "text-[#d4af37]/70 hover:bg-[#6A0DAD]/15"}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                set("rolePingIds", checked
                                  ? form.rolePingIds.filter(id => id !== r.id)
                                  : [...form.rolePingIds, r.id])
                              }
                              className="accent-[#6A0DAD] w-3.5 h-3.5"
                            />
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: r.color !== "#000000" ? r.color : "#6A0DAD" }}
                            />
                            @{r.name}
                          </label>
                        );
                      })
                    )}
                  </div>
                  {form.rolePingIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {form.rolePingIds.map(id => {
                        const r = (rolesQ.data ?? []).find(x => x.id === id);
                        return r ? (
                          <span key={id} className="text-[10px] border border-[#d4af37]/40 rounded px-1.5 py-0.5 text-[#e8d48b] bg-[#6A0DAD]/20">
                            @{r.name}
                          </span>
                        ) : null;
                      })}
                      <button onClick={() => set("rolePingIds", [])} className="text-[10px] text-red-400/70 hover:text-red-400 px-1">
                        clear
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* RSVP */}
          <Card className="bg-[#12121a] border-[#d4af37]/40">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[#d4af37] text-sm tracking-widest uppercase">
                  🎟️ RSVP System
                </CardTitle>
                <Switch checked={form.rsvpEnabled} onCheckedChange={v => set("rsvpEnabled", v)} />
              </div>
            </CardHeader>
            {form.rsvpEnabled && (
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className={labelCls}>Max Attendees</Label>
                    <Input type="number" min={1} className={inputCls} value={form.maxAttendees}
                      onChange={e => set("maxAttendees", e.target.value)} placeholder="Unlimited" />
                  </div>
                  <div>
                    <Label className={labelCls}>RSVP Deadline (CDT)</Label>
                    <Input type="datetime-local" className={inputCls} value={form.rsvpDeadlineLocal}
                      onChange={e => set("rsvpDeadlineLocal", e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label className={labelCls}>DM Message (sent on RSVP)</Label>
                  <Textarea className={`${inputCls} min-h-20`} value={form.dmMessage}
                    onChange={e => set("dmMessage", e.target.value)}
                    placeholder="You're in. The Eye sees you. Details below..." />
                </div>
                <div>
                  <Label className={labelCls}>Game Link (included in DMs & reminders)</Label>
                  <Input className={inputCls} value={form.gameLink}
                    onChange={e => set("gameLink", e.target.value)} placeholder="https://epicpoker..." />
                </div>
                <div>
                  <Label className={labelCls}>Auto-Assign Role on RSVP</Label>
                  <Select value={form.autoAssignRoleId || undefined} onValueChange={v => set("autoAssignRoleId", v)}>
                    <SelectTrigger className={inputCls}>
                      <SelectValue placeholder="No role" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#12121a] border-[#d4af37]/40">
                      <SelectItem value={NONE} className="text-[#e8d48b]">No role</SelectItem>
                      {(rolesQ.data ?? []).map(r => (
                        <SelectItem key={r.id} value={r.id} className="text-[#e8d48b]">
                          @{r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className={labelCls}>Reminder DMs</Label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    {([
                      ["remind1h", "1 hour before"],
                      ["remind10m", "10 minutes before"],
                      ["remindAtStart", "At start"],
                    ] as const).map(([key, label]) => (
                      <label key={key}
                        className="flex items-center gap-2 text-sm text-[#e8d48b] border border-[#d4af37]/30 rounded px-3 py-2 bg-[#0a0a0f]">
                        <Switch checked={form[key]} onCheckedChange={v => set(key, v)} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Send */}
          <Button
            disabled={!canSend}
            onClick={() => sendMut.mutate(formToPayload(form))}
            className="epic-btn w-full h-12 text-base tracking-widest">
            {sendMut.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
            ) : (
              <Send className="w-5 h-5 mr-2" />
            )}
            SEND EMBED
          </Button>
        </div>

        {/* ============ PREVIEW COLUMN ============ */}
        <div className="space-y-6">
          <Card className="bg-[#12121a] border-[#d4af37]/40 lg:sticky lg:top-20">
            <CardHeader className="pb-2">
              <CardTitle className="text-[#d4af37] text-sm tracking-widest uppercase">
                👁 Live Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Discord-style message mock */}
              <div className="rounded-lg bg-[#313338] p-4" style={{ fontFamily: "system-ui, sans-serif" }}>
                <div className="flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#6A0DAD] flex items-center justify-center text-lg shrink-0">
                    👁
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[#f2f3f5] font-semibold text-sm">EPIC Bot</span>
                      <span className="bg-[#5865F2] text-white text-[10px] px-1 rounded">BOT</span>
                      <span className="text-[#949ba4] text-xs">Today</span>
                    </div>
                    {pingRoles.length > 0 && (
                      <div className="mt-0.5">
                        {pingRoles.map(r => (
                          <span key={r.id} className="bg-[#5865F2]/30 text-[#c9cdfb] text-sm rounded px-1 mr-1">
                            @{r.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Embed */}
                    <div
                      className="mt-1 rounded bg-[#2b2d31] overflow-hidden max-w-[440px]"
                      style={{ borderLeft: `4px solid ${form.color || "#6A0DAD"}` }}>
                      <div className="p-3 pr-4">
                        <div className="flex gap-3">
                          <div className="flex-1 min-w-0">
                            {form.title && (
                              <div className="text-[#f2f3f5] font-semibold text-sm break-words">
                                {form.title}
                              </div>
                            )}
                            {form.description && (
                              <div className="text-[#dbdee1] text-sm mt-1 whitespace-pre-wrap break-words">
                                {form.description}
                              </div>
                            )}
                            {previewTime && (
                              <div className="mt-2">
                                <div className="text-[#f2f3f5] text-xs font-semibold">📅 Event Time</div>
                                <div className="text-[#dbdee1] text-sm">{formatChicago(previewTime)}</div>
                              </div>
                            )}
                            {form.rsvpEnabled && (
                              <div className="mt-2">
                                <div className="text-[#f2f3f5] text-xs font-semibold">🎟️ RSVP</div>
                                <div className="text-[#dbdee1] text-sm">
                                  React with ✅ to RSVP!
                                  {form.maxAttendees && (
                                    <> Max attendees: <b>{form.maxAttendees}</b>.</>
                                  )}
                                  {previewDeadline && <> RSVP by {formatChicago(previewDeadline)}.</>}
                                </div>
                              </div>
                            )}
                          </div>
                          {form.thumbnailUrl && (
                            <img
                              src={form.thumbnailUrl}
                              alt=""
                              className="w-20 h-20 rounded object-cover shrink-0"
                              onError={e => ((e.target as HTMLImageElement).style.display = "none")}
                            />
                          )}
                        </div>
                        {form.imageUrl && (
                          <img
                            src={form.imageUrl}
                            alt=""
                            className="mt-3 rounded max-h-64 w-full object-cover"
                            onError={e => ((e.target as HTMLImageElement).style.display = "none")}
                          />
                        )}
                        {form.footerText && (
                          <div className="text-[#949ba4] text-xs mt-2">{form.footerText}</div>
                        )}
                      </div>
                    </div>
                    {form.rsvpEnabled && (
                      <div className="mt-1.5 inline-flex items-center gap-1 bg-[#2b2d31] border border-[#3f4147] rounded-full px-2 py-0.5 text-sm">
                        ✅ <span className="text-[#dbdee1] text-xs">1</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-[#d4af37]/40 mt-2 text-center tracking-wide">
                Preview approximates Discord's rendering. Times shown in CDT.
              </p>
            </CardContent>
          </Card>

          {/* RSVP events tracker */}
          <Card className="bg-[#12121a] border-[#d4af37]/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-[#d4af37] text-sm tracking-widest uppercase">
                🗓 Posted RSVP Events
              </CardTitle>
            </CardHeader>
            <CardContent>
              {eventsQ.isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-[#d4af37]" />
              ) : (eventsQ.data ?? []).length === 0 ? (
                <p className="text-sm text-[#d4af37]/50">No RSVP events posted yet.</p>
              ) : (
                <div className="space-y-2">
                  {(eventsQ.data ?? []).map(e => (
                    <div key={e.id}
                      className="flex items-center justify-between border border-[#d4af37]/25 rounded px-3 py-2 bg-[#0a0a0f]">
                      <div className="min-w-0">
                        <div className="text-sm text-[#e8d48b] truncate">{e.title || "(untitled)"}</div>
                        <div className="text-xs text-[#d4af37]/50">
                          {e.event_time_utc ? formatChicago(e.event_time_utc) : "No time set"}
                        </div>
                      </div>
                      <button
                        onClick={() => setAttendeesFor(e.id)}
                        className="flex items-center gap-1 text-xs text-[#d4af37] border border-[#d4af37]/40 rounded px-2 py-1 hover:bg-[#6A0DAD]/30 shrink-0">
                        <Users className="w-3 h-3" />
                        {e.attendee_count}
                        {e.max_attendees ? `/${e.max_attendees}` : ""}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Save-template dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="bg-[#12121a] border-[#d4af37]/50">
          <DialogHeader>
            <DialogTitle className="text-[#d4af37] tracking-widest">Save as Template</DialogTitle>
          </DialogHeader>
          <Input
            className={inputCls}
            placeholder="Template name (e.g. Friday Poker Night)"
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button
              className="epic-btn"
              disabled={!templateName.trim() || saveMut.isPending}
              onClick={() =>
                saveMut.mutate({ ...formToPayload(form), name: templateName.trim() })
              }>
              {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-[#12121a] border-[#d4af37]/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#d4af37]">Delete template?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#e8d48b]/70">
              "{deleteTarget?.name}" will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#d4af37]/40 text-[#d4af37]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-900 text-red-100 hover:bg-red-800 border border-red-500/50"
              onClick={() => deleteTarget && deleteMut.mutate({ id: deleteTarget.id })}>
              {deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Attendees dialog */}
      <Dialog open={attendeesFor !== null} onOpenChange={open => !open && setAttendeesFor(null)}>
        <DialogContent className="bg-[#12121a] border-[#d4af37]/50">
          <DialogHeader>
            <DialogTitle className="text-[#d4af37] tracking-widest">Attendees</DialogTitle>
          </DialogHeader>
          {attendeesQ.isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-[#d4af37]" />
          ) : (attendeesQ.data ?? []).length === 0 ? (
            <p className="text-sm text-[#d4af37]/50">No RSVPs yet.</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {(attendeesQ.data ?? []).map(a => (
                <div key={a.discord_user_id}
                  className="flex justify-between text-sm text-[#e8d48b] border-b border-[#d4af37]/15 py-1">
                  <span>{a.discord_username ?? a.discord_user_id}</span>
                  <span className="text-xs text-[#d4af37]/50">
                    {new Date(a.rsvped_at).toLocaleString("en-US", { timeZone: "America/Chicago" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
