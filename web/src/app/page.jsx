import { useEffect } from 'react';
import { useNavigate } from 'react-router';

export const meta = () => [
  { title: "SignalWire AI IVR Demo" },
  { name: "description", content: "AI-powered phone menu system" },
];

export default function Home() {
  const navigate = useNavigate();
  
  useEffect(() => {
    // Automatically redirect to demo-ivr
    navigate('/demo-ivr');
  }, [navigate]);
  
  return null;
}
