import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// Logo TK Solution em SVG — fiel ao manual de identidade visual
function TKLogoSVG({ color = '#FFFFFF' }: { color?: string }) {
  return (
    <svg
      viewBox="0 0 220 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
    >
      {/* T — barra horizontal + stem vertical */}
      <rect x="10" y="20" width="100" height="20" fill={color} />
      <rect x="45" y="40" width="22" height="110" fill={color} />

      {/* K — stem + braço superior + braço inferior */}
      <rect x="120" y="20" width="20" height="130" fill={color} />
      {/* Braço superior */}
      <polygon points="140,20 210,20 210,42 158,90 140,90" fill={color} />
      {/* Braço inferior */}
      <polygon points="140,88 158,88 210,136 210,158 140,150" fill={color} />

      {/* SOLUTION */}
      <text
        x="110"
        y="188"
        textAnchor="middle"
        fill={color}
        fontSize="20"
        fontWeight="700"
        fontFamily="'Leelawadee UI', 'Inter', sans-serif"
        letterSpacing="5"
      >
        SOLUTION
      </text>
    </svg>
  );
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao entrar',
        description: error.message,
      });
    } else {
      navigate('/dashboard');
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex">
      {/* Painel esquerdo — identidade TK Solution (#000000 com logo branca) */}
      <div className="hidden lg:flex lg:w-1/2 bg-black flex-col items-center justify-center p-12 relative overflow-hidden">
        {/* Logo */}
        <div className="w-52 h-52 mb-8">
          <TKLogoSVG color="#FFFFFF" />
        </div>

        {/* Tagline */}
        <p className="text-[#808080] text-sm tracking-widest uppercase text-center">
          Sistema Interno
        </p>
        <p className="text-white/40 text-xs mt-2 text-center">
          Gestão de Documentos & Assistente IA
        </p>
      </div>

      {/* Painel direito — formulário */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white dark:bg-[#0d0d0d]">
        {/* Logo mobile (só aparece em telas pequenas) */}
        <div className="lg:hidden w-28 h-28 mb-8 bg-black rounded-xl p-4">
          <TKLogoSVG color="#FFFFFF" />
        </div>

        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-black dark:text-white tracking-tight">
              Bem-vindo de volta
            </h1>
            <p className="text-[#808080] text-sm mt-1">
              Entre com suas credenciais corporativas
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label
                htmlFor="email"
                className="text-xs font-semibold uppercase tracking-wider text-[#808080]"
              >
                E-mail
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@tksolution.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-[#808080]/30 focus-visible:ring-[#004C97] focus-visible:border-[#004C97] h-11"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="password"
                className="text-xs font-semibold uppercase tracking-wider text-[#808080]"
              >
                Senha
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="border-[#808080]/30 focus-visible:ring-[#004C97] focus-visible:border-[#004C97] h-11 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#808080] hover:text-black dark:hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-11 bg-[#004C97] hover:bg-[#003a73] text-white font-semibold tracking-wide transition-colors"
              disabled={loading}
            >
              {loading ? (
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Entrar'
              )}
            </Button>

            <div className="text-center">
              <Link
                to="/forgot-password"
                className="text-xs text-[#808080] hover:text-[#004C97] transition-colors"
              >
                Esqueci minha senha
              </Link>
            </div>
          </form>

          {/* Rodapé */}
          <p className="text-center text-[#808080] text-xs mt-12">
            © {new Date().getFullYear()} TK Solution. Uso interno.
          </p>
        </div>
      </div>
    </div>
  );
}
