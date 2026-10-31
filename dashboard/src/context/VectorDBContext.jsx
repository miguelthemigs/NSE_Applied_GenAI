import { createContext, useContext, useState, useEffect } from 'react';

const VectorDBContext = createContext();

export function VectorDBProvider({ children }) {
  const [vectorData, setVectorData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Load vector DB stats on mount
  useEffect(() => {
    loadVectorDBStats();
  }, []);

  const loadVectorDBStats = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:5001/api/vector-stats');
      const data = await response.json();
      
      if (data.status === 'success') {
        setVectorData(data.data || []);
        setLastUpdated(new Date().toLocaleTimeString());
        setError(null);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(`Connection error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <VectorDBContext.Provider value={{ vectorData, loading, error, lastUpdated, refresh: loadVectorDBStats }}>
      {children}
    </VectorDBContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useVectorDB() {
  const context = useContext(VectorDBContext);
  if (!context) {
    throw new Error('useVectorDB must be used within VectorDBProvider');
  }
  return context;
}