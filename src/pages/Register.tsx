import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, UserPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Invite {
  id: string;
  email: string;
  token: string;
  status: string;
  expires_at: string;
}

export default function Register() {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('token');
  const inviteEmailParam = searchParams.get('email') || '';
  
  const [invite, setInvite] = useState<Invite | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  const [isInvalidInvite, setIsInvalidInvite] = useState(false);
  const [invalidReason, setInvalidReason] = useState('');
  
  const [email, setEmail] = useState(inviteEmailParam);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    validateInvite();
  }, [inviteToken]);

  const validateInvite = async () => {
    if (!inviteToken) {
      setIsValidating(false);
      setIsInvalidInvite(true);
      setInvalidReason('O cadastro é apenas por convite. Entre em contato com um administrador para receber seu convite.');
      return;
    }

    const { data, error } = await supabase
      .from('invites')
      .select('*')
      .eq('token', inviteToken)
      .single();

    if (error || !data) {
      setIsValidating(false);
      setIsInvalidInvite(true);
      setInvalidReason('Convite inválido ou não encontrado.');
      return;
    }

    if (data.status === 'accepted') {
      setIsValidating(false);
      setIsInvalidInvite(true);
      setInvalidReason('Este convite já foi utilizado.');
      return;
    }

    if (new Date(data.expires_at) < new Date()) {
      setIsValidating(false);
      setIsInvalidInvite(true);
      setInvalidReason('Este convite expirou. Solicite um novo convite ao administrador.');
      return;
    }

    setInvite(data);
    setEmail(data.email);
    setIsValidating(false);
  };

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 11) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhone(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'As senhas não coincidem',
      });
      return;
    }

    if (password.length < 6) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'A senha deve ter pelo menos 6 caracteres',
      });
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
        },
      },
    });

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao criar conta',
        description: error.message,
      });
      setLoading(false);
      return;
    }

    // Mark invite as accepted
    if (invite) {
      await supabase
        .from('invites')
        .update({ status: 'accepted' })
        .eq('id', invite.id);
    }

    toast({
      title: 'Conta criada!',
      description: 'Verifique seu email para confirmar a conta.',
    });
    navigate('/login');
    setLoading(false);
  };

  if (isValidating) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Validando convite...</p>
          </div>
        </div>
      </div>
    );
  }

  if (isInvalidInvite) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md animate-fade-in">
            <CardHeader className="text-center space-y-4">
              <div className="flex justify-center">
                <Logo size="lg" />
              </div>
              <CardTitle className="text-2xl">Acesso Restrito</CardTitle>
              <CardDescription>
                {invalidReason}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate('/login')}
              >
                Voltar para Login
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md animate-fade-in">
          <CardHeader className="text-center space-y-4">
            <div className="flex justify-center">
              <Logo size="lg" />
            </div>
            <CardTitle className="text-2xl">Criar Conta</CardTitle>
            <CardDescription>
              Complete seu cadastro para acessar a plataforma
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  readOnly
                  className="bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fullName">Nome Completo</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Seu nome completo"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Celular</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(00) 00000-0000"
                  value={phone}
                  onChange={handlePhoneChange}
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirmar Senha</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <div className="animate-spin h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full" />
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Criar Conta
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}