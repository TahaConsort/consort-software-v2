import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, Mail, Lock, Eye, EyeOff, Building2, User, Phone, MapPin,
  Loader2, ShieldCheck, Ship, FileText,
} from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/authStore";
import { register as registerRequest } from "@/services/authService";
import { createQuery } from "@/services/queryService";
import { readQuoteDraft, clearQuoteDraft } from "@/lib/quoteDraft";
import { labelForService } from "@/lib/catalog";

const INITIAL = {
  companyName: "", country: "", city: "", address: "", industry: "",
  contactName: "", position: "", email: "", phone: "",
  password: "", confirmPassword: "",
  fax: "", // honeypot — hidden from humans
};

/**
 * Customer sign-up (CRM_MASTER §5.16/§5.20). The storefront's "Get a quote"
 * gate: creating the account provisions the company, contact, customer record
 * and portal login in one step, then submits the parked rate-calculator
 * selection as a real query so Operations can price it.
 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(INITIAL);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draft] = useState(() => readQuoteDraft());

  const set = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) return toast.error("The two passwords don't match");
    if (form.password.length < 8) return toast.error("Password must be at least 8 characters");

    setLoading(true);
    try {
      const data = await registerRequest({
        companyName: form.companyName,
        country: form.country || undefined,
        city: form.city || undefined,
        address: form.address || undefined,
        industry: form.industry || undefined,
        contactName: form.contactName,
        position: form.position || undefined,
        email: form.email,
        phone: form.phone,
        password: form.password,
        fax: form.fax,
      });

      // Signed in by the same response that created the account.
      useAuthStore.getState().setAuth({
        user: data.user,
        accessToken: data.accessToken,
        permissions: data.permissions,
      });
      toast.success(data.message || "Welcome to Consort");

      // Submit the parked storefront selection as their first request.
      if (draft && data.user?.customerId) {
        try {
          const q = await createQuery({
            customerId: data.user.customerId,
            services: draft.services,
            originPort: draft.originPort || undefined,
            destinationPort: draft.destinationPort || undefined,
            containerTypeCode: draft.containerTypeCode || undefined,
            weightKg: draft.weightKg || undefined,
            cargoDescription: draft.cargoDescription || undefined,
          });
          clearQuoteDraft();
          toast.success(`Request ${q?.data?.referenceNo ?? ""} sent — our team will quote it shortly`.trim());
        } catch (err) {
          // The account exists either way; they can re-raise it in the portal.
          toast.error(err?.message || "Account created, but the request needs re-sending from your portal");
        }
      }

      navigate("/dashboard");
    } catch (err) {
      toast.error(err?.message || "Could not create your account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* LEFT — brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-10 text-white overflow-hidden bg-zinc-900">
        <div className="absolute inset-0 z-[5] bg-gradient-to-l from-zinc-900 to-[#0043E0]/40" />
        <div className="absolute inset-0 z-[6] bg-[linear-gradient(to_right,#ffffff10_1px,transparent_1px),linear-gradient(to_bottom,#ffffff10_1px,transparent_1px)] bg-[size:40px_40px]" />
        <div className="absolute top-0 left-0 w-72 h-72 bg-primary/20 blur-3xl rounded-full opacity-30 z-[4]" />

        <div className="relative h-full flex flex-col justify-between z-10">
          <Link to="/" className="text-2xl tracking-tight flex items-center gap-4">
            <img src="/logo.png" alt="Consort Group logo" className="w-16 object-cover" />
            <span className="flex flex-col">
              <span className="font-bold">Consort Group</span>
              <span className="text-sm text-zinc-50">Transportation, Logistics &amp; Supply Chain</span>
            </span>
          </Link>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 mt-16">
            <h2 className="text-4xl font-bold leading-tight">
              Create your account to get a formal quote.
            </h2>
            <div className="space-y-4 text-slate-300">
              <div className="flex items-center gap-3"><FileText className="w-5 h-5 text-white" /> Receive priced quotations online</div>
              <div className="flex items-center gap-3"><Ship className="w-5 h-5 text-white" /> Track every shipment stage live</div>
              <div className="flex items-center gap-3"><ShieldCheck className="w-5 h-5 text-white" /> Invoices and documents in one place</div>
            </div>
          </motion.div>

          <p className="mt-16 text-sm text-slate-400">© 2026 Consort Group</p>
        </div>
      </div>

      {/* RIGHT — form */}
      <div className="flex items-center justify-center p-6 bg-muted/40 overflow-y-auto">
        <div className="w-full max-w-lg my-8 py-8 px-6 rounded-2xl border bg-white/80 dark:bg-zinc-900 backdrop-blur-sm shadow-xl">
          <div className="text-center pb-5">
            <h1 className="text-2xl font-semibold">Create your account</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Already registered?{" "}
              <Link to="/login" className="text-primary hover:underline font-medium">Sign in</Link>
            </p>
          </div>

          {/* Parked storefront selection */}
          {draft && (
            <div className="mb-5 rounded-xl border bg-primary/5 border-primary/20 p-3.5 space-y-2">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-primary" /> Your quote request is saved
              </p>
              <div className="flex flex-wrap gap-1">
                {draft.services.map((s) => (
                  <Badge key={s} variant="secondary" className="text-[10px]">{labelForService(s)}</Badge>
                ))}
              </div>
              {draft.originPort && draft.destinationPort && (
                <p className="text-xs text-muted-foreground">{draft.originPort} → {draft.destinationPort}</p>
              )}
              <p className="text-[11px] text-muted-foreground">We'll send it to our pricing team as soon as you finish signing up.</p>
            </div>
          )}

          <form onSubmit={submit} className="space-y-5">
            {/* Honeypot */}
            <input type="text" name="fax" tabIndex={-1} autoComplete="off" className="hidden"
              value={form.fax} onChange={set} />

            {/* Company */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</p>
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company name *</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="companyName" name="companyName" value={form.companyName} onChange={set}
                    disabled={loading} required className="pl-10 h-11" placeholder="Acme Trading Pvt Ltd" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="country">Country</Label>
                  <Input id="country" name="country" value={form.country} onChange={set} disabled={loading} placeholder="Pakistan" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" name="city" value={form.city} onChange={set} disabled={loading} placeholder="Karachi" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="address">Address</Label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="address" name="address" value={form.address} onChange={set} disabled={loading}
                    className="pl-10" placeholder="Optional" />
                </div>
              </div>
            </div>

            {/* Contact */}
            <div className="space-y-3 pt-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your details</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="contactName">Full name *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="contactName" name="contactName" value={form.contactName} onChange={set}
                      disabled={loading} required className="pl-10" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="position">Job title</Label>
                  <Input id="position" name="position" value={form.position} onChange={set} disabled={loading} placeholder="Optional" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Work email *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="email" name="email" type="email" value={form.email} onChange={set}
                      disabled={loading} required autoComplete="email" className="pl-10" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">Phone *</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="phone" name="phone" value={form.phone} onChange={set}
                      disabled={loading} required className="pl-10" placeholder="+92 300 1234567" />
                  </div>
                </div>
              </div>
            </div>

            {/* Password */}
            <div className="space-y-3 pt-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password *</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="password" name="password" type={showPassword ? "text" : "password"}
                      value={form.password} onChange={set} disabled={loading} required
                      autoComplete="new-password" className="pl-10 pr-10" placeholder="Min. 8 characters" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm *</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input id="confirmPassword" name="confirmPassword" type={showPassword ? "text" : "password"}
                      value={form.confirmPassword} onChange={set} disabled={loading} required
                      autoComplete="new-password" className="pl-10" />
                  </div>
                </div>
              </div>
            </div>

            <Button type="submit" disabled={loading} className="w-full h-11 gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating your account…</>
                : <>{draft ? "Create account & send request" : "Create account"} <ArrowRight className="w-4 h-4" /></>}
            </Button>

            <p className="text-[11px] text-center text-muted-foreground">
              By creating an account you agree to be contacted about your shipping requests.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
