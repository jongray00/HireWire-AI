"use client";

import { useEffect } from 'react';
import { useNavigate } from 'react-router';

export default function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is logged in
    const session = localStorage.getItem('sally_sales_session');

    if (session) {
      try {
        const sessionData = JSON.parse(session);
        if (sessionData.isLoggedIn && sessionData.credentials) {
          // Logged in, redirect to dashboard
          navigate('/dashboard');
          return;
        }
      } catch (e) {
        // Invalid session, clear it
        localStorage.removeItem('sally_sales_session');
      }
    }

    // Not logged in, redirect to login
    navigate('/login');
  }, [navigate]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-2 border-[#2553F4] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="hw-mono text-[10px] tracking-[0.18em] uppercase text-[#737373]">
          Loading
        </p>
      </div>
    </div>
  );
}
