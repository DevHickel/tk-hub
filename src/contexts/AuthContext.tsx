import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'admin' | 'user' | 'tk_master';

interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: 'admin' | 'user';
  theme_preference: string | null;
  points: number;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  appRoles: AppRole[];
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [appRoles, setAppRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = appRoles.includes('admin') || appRoles.includes('tk_master');

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
    return data as Profile;
  };

  const fetchAppRoles = async (userId: string) => {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    
    if (error) {
      console.error('Error fetching app roles:', error);
      return [];
    }
    return (data || []).map(r => r.role as AppRole);
  };

  const refreshProfile = async () => {
    if (user) {
      const [profileData, roles] = await Promise.all([
        fetchProfile(user.id),
        fetchAppRoles(user.id)
      ]);
      setProfile(profileData);
      setAppRoles(roles);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const [profileData, roles] = await Promise.all([
          fetchProfile(session.user.id),
          fetchAppRoles(session.user.id)
        ]);
        setProfile(profileData);
        setAppRoles(roles);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          const [profileData, roles] = await Promise.all([
            fetchProfile(session.user.id),
            fetchAppRoles(session.user.id)
          ]);
          setProfile(profileData);
          setAppRoles(roles);
        } else {
          setProfile(null);
          setAppRoles([]);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setAppRoles([]);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, appRoles, isAdmin, loading, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
