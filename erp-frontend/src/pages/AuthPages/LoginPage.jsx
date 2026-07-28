import { CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useState } from "react";
import { BarChart3, Users } from "lucide-react";
import { ArrowRight, Mail, Lock, Eye, EyeOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTypingEffect } from "@/hooks/useTypingEffect";
import toast from "react-hot-toast";
import { useAuthStore } from "@/store/authStore";
import { login as loginRequest } from "@/services/authService";
import { homeRouteForRole } from "@/lib/roles";

// ─── Static constant lives outside the component so it never changes reference
const TAGLINE =
  "We moves what matters to create new possibilities for everyone.";

export default function LoginPage() {
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const displayedText = useTypingEffect(TAGLINE, 40);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const data = await loginRequest(email, password);

      useAuthStore.getState().setAuth({
        user: data.user,
        accessToken: data.accessToken,
        permissions: data.permissions,
      });

      toast.success("Login successful");
      navigate(homeRouteForRole(data.user.role));
    } catch (err) {
      // axios interceptor normalizes errors to { message, status }
      toast.error(err?.message || "Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* LEFT SIDEBAR */}
      <div className="relative hidden lg:flex flex-col justify-between p-10 text-white overflow-hidden bg-zinc-900">
        {/* Gradient Overlay */}
        <div className="absolute inset-0 z-[5] bg-gradient-to-l from-zinc-900 to-[#0043E0]/40" />

        {/* GRID */}
        <div className="absolute inset-0 z-[6] bg-[linear-gradient(to_right,#ffffff10_1px,transparent_1px),linear-gradient(to_bottom,#ffffff10_1px,transparent_1px)] bg-[size:40px_40px]" />

        {/* Glow */}
        <div className="absolute top-0 left-0 w-72 h-72 bg-primary/20 blur-3xl rounded-full opacity-30 z-[4]" />
        <div className="absolute bottom-0 right-0 w-72 h-72 bg-primary/20 blur-3xl rounded-full opacity-30 z-[4]" />

        <div className="relative h-full flex flex-col justify-between z-10">
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="text-2xl tracking-tight flex items-center gap-4.5">
              <img
                src="/logo.png"
                alt="Consort Group logo"
                className="w-16 object-cover"
              />
              <span className="flex flex-col">
                <span className="font-bold">Consort Group</span>
                <span className="text-sm text-zinc-50 mt-0">
                  Transportations, Logistics &amp; Supply Chain Management
                </span>
              </span>
            </div>
          </motion.div>

          {/* Center */}
          <div className="space-y-6 mt-20">
            <h2 className="text-4xl capitalize font-bold leading-tight min-h-[80px]">
              {displayedText}
              <span className="animate-pulse">|</span>
            </h2>

            {/* Features */}
            <div className="space-y-4 text-slate-300">
              <motion.div
                className="flex items-center gap-3"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
              >
                <BarChart3 className="w-5 h-5 text-white" />
                Transportation Management
              </motion.div>

              <motion.div
                className="flex items-center gap-3"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Users className="w-5 h-5 text-white" />
                Employee Management
              </motion.div>
            </div>
          </div>

          {/* Footer */}
          <motion.div
            className="mt-20 text-sm text-slate-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
          >
            © 2026 Consort Group
          </motion.div>
        </div>
      </div>

      {/*  RIGHT LOGIN */}
      <div className="flex items-center justify-center p-6 bg-muted/40">
        <div className="w-full max-w-md py-8 px-5 rounded-2xl border bg-white/80 dark:bg-zinc-900 backdrop-blur-sm shadow-xl">
          {/* HEADER */}
          <CardHeader className="text-center pb-4">
            <h1 className="text-2xl font-semibold">Welcome</h1>
            <p className="text-sm">Sign in to your account</p>
            <p className="text-sm text-muted-foreground mt-1">
              New customer?{" "}
              <Link to="/register" className="text-primary hover:underline font-medium">
                Create an account
              </Link>
            </p>
          </CardHeader>

          {/* CONTENT */}
          <CardContent className="space-y-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email
                </Label>
                <div className="relative group">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    autoComplete="email"
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-11 rounded-lg border border-gray-400 focus-visible:ring-2 focus-visible:ring-primary/20"
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium">
                    Password
                  </Label>
                  <Link
                    to="/forgot-password"
                    className="text-xs text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>

                <div className="relative group">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />

                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password"
                    value={password}
                    autoComplete="current-password"
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10 pr-10 h-11 rounded-lg border border-gray-400 focus-visible:ring-2 focus-visible:ring-primary/20"
                    required
                  />

                  {/* Toggle */}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 rounded-lg flex items-center justify-center gap-2 text-sm font-medium shadow-sm hover:shadow-md transition-all disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? "Signing in…" : "Sign in"}
                <ArrowRight
                  aria-hidden="true"
                  className="w-4 h-4 group-hover:translate-x-1 transition"
                />
              </Button>
            </form>
          </CardContent>
        </div>
      </div>
    </div>
  );
}
