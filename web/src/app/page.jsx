import { useEffect } from 'react';
import { useNavigate } from 'react-router';

export default function Home() {
  const navigate = useNavigate();
  
  useEffect(() => {
    // Automatically redirect to demo-ivr
    navigate('/demo-ivr');
  }, [navigate]);
  
  return null;
}
