'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChartIcon, CalendarIcon, ShopfloorsIcon } from '@/components/Icons';
import { toast } from 'react-toastify';

interface Lab {
  _id: string;
  name: string;
}

interface Machine {
  _id: string;
  machineName: string;
  labId: string;
  status: 'active' | 'inactive';
}

interface MaintenanceStats {
  totalMachines: number;
  scheduledMaintenanceCount: number;
  machinesWithMaintenance: string[];
  totalDowntime: number; // in seconds
  totalUptime: number; // in seconds
  downtimePercentage: number;
  uptimePercentage: number;
}

export default function AIInsightsPage() {
  const router = useRouter();
  const [selectedLabId, setSelectedLabId] = useState<string>('');
  const [labs, setLabs] = useState<Lab[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [maintenanceStats, setMaintenanceStats] = useState<MaintenanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [user, setUser] = useState<any>(null);

  // Check if user is logged in
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isLoggedIn = localStorage.getItem('isLoggedIn');
      const userStr = localStorage.getItem('user');
      
      if (!isLoggedIn || !userStr) {
        router.push('/login');
        return;
      }
      
      try {
        const userData = JSON.parse(userStr);
        setUser(userData);
        fetchUserLabs(userData._id);
      } catch (error) {
        console.error('Error parsing user data:', error);
        router.push('/login');
      }
    }
  }, [router]);

  // Fetch labs for the logged-in user
  const fetchUserLabs = async (userId: string) => {
    try {
      const response = await fetch(`/api/labs/user?userId=${userId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch labs');
      }
      const data = await response.json();
      if (data.labs && data.labs.length > 0) {
        setLabs(data.labs);
        // Auto-select first lab
        setSelectedLabId(data.labs[0]._id);
      } else {
        toast.error('No labs found for this user');
      }
    } catch (error: any) {
      console.error('Error fetching labs:', error);
      toast.error('Failed to load labs');
    } finally {
      setLoading(false);
    }
  };

  // Fetch machines for selected lab
  useEffect(() => {
    if (selectedLabId) {
      fetchMachinesForLab(selectedLabId);
      fetchMaintenanceStats(selectedLabId);
    }
  }, [selectedLabId]);

  const fetchMachinesForLab = async (labId: string) => {
    try {
      const response = await fetch(`/api/machines?labId=${labId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch machines');
      }
      const data = await response.json();
      setMachines(data.machines || []);
    } catch (error: any) {
      console.error('Error fetching machines:', error);
      toast.error('Failed to load machines');
    }
  };

  const fetchMaintenanceStats = async (labId: string) => {
    setLoadingStats(true);
    try {
      // First, get all machines for this lab
      const machinesResponse = await fetch(`/api/machines?labId=${labId}`);
      if (!machinesResponse.ok) {
        throw new Error('Failed to fetch machines');
      }
      const machinesData = await machinesResponse.json();
      const labMachines = machinesData.machines || [];
      const machineIds = labMachines.map((m: Machine) => m._id);

      if (machineIds.length === 0) {
        setMaintenanceStats({
          totalMachines: 0,
          scheduledMaintenanceCount: 0,
          machinesWithMaintenance: [],
          totalDowntime: 0,
          totalUptime: 0,
          downtimePercentage: 0,
          uptimePercentage: 100,
        });
        setLoadingStats(false);
        return;
      }

      // Fetch work orders for the past month for these machines
      const workOrdersResponse = await fetch('/api/work-orders');
      if (!workOrdersResponse.ok) {
        throw new Error('Failed to fetch work orders');
      }
      const workOrdersData = await workOrdersResponse.json();
      const allWorkOrders = workOrdersData.data || [];

      // Filter work orders from past month for machines in this lab
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const relevantWorkOrders = allWorkOrders.filter((wo: any) => {
        const workOrderDate = new Date(wo.createdAt || wo._time);
        const isInPastMonth = workOrderDate >= oneMonthAgo;
        const isForLabMachine = machineIds.includes(wo.machineId);
        return isInPastMonth && isForLabMachine;
      });

      // Count unique machines that had maintenance
      const machinesWithMaintenance = new Set(
        relevantWorkOrders.map((wo: any) => wo.machineId)
      );

      // Fetch downtime stats for all machines in the lab (last 7 days)
      let totalDowntime = 0;
      let totalUptime = 0;
      let totalTimePeriod = 0;

      try {
        const downtimePromises = machineIds.map(async (machineId: string) => {
          try {
            const downtimeResponse = await fetch(`/api/influxdb/downtime?machineId=${machineId}&timeRange=-7d`);
            if (downtimeResponse.ok) {
              const downtimeData = await downtimeResponse.json();
              if (downtimeData.data) {
                return {
                  downtime: downtimeData.data.totalDowntime || 0,
                  uptime: downtimeData.data.totalUptime || 0,
                  totalTime: (downtimeData.data.totalDowntime || 0) + (downtimeData.data.totalUptime || 0),
                };
              }
            }
          } catch (error) {
            console.error(`Error fetching downtime for machine ${machineId}:`, error);
          }
          return { downtime: 0, uptime: 0, totalTime: 0 };
        });

        const downtimeResults = await Promise.all(downtimePromises);
        
        // Aggregate downtime and uptime
        downtimeResults.forEach(result => {
          totalDowntime += result.downtime;
          totalUptime += result.uptime;
          totalTimePeriod += result.totalTime;
        });

        // If no data, use a default time period (7 days per machine)
        if (totalTimePeriod === 0 && machineIds.length > 0) {
          const sevenDaysInSeconds = 7 * 24 * 60 * 60;
          totalTimePeriod = sevenDaysInSeconds * machineIds.length;
          totalUptime = totalTimePeriod; // Assume all uptime if no data
        }
      } catch (error) {
        console.error('Error fetching downtime stats:', error);
        // Continue with zero downtime if there's an error
      }

      const downtimePercentage = totalTimePeriod > 0 ? (totalDowntime / totalTimePeriod) * 100 : 0;
      const uptimePercentage = totalTimePeriod > 0 ? (totalUptime / totalTimePeriod) * 100 : 100;

      setMaintenanceStats({
        totalMachines: labMachines.length,
        scheduledMaintenanceCount: relevantWorkOrders.length,
        machinesWithMaintenance: Array.from(machinesWithMaintenance),
        totalDowntime,
        totalUptime,
        downtimePercentage,
        uptimePercentage,
      });
    } catch (error: any) {
      console.error('Error fetching maintenance stats:', error);
      toast.error('Failed to load maintenance statistics');
      setMaintenanceStats({
        totalMachines: machines.length,
        scheduledMaintenanceCount: 0,
        machinesWithMaintenance: [],
        totalDowntime: 0,
        totalUptime: 0,
        downtimePercentage: 0,
        uptimePercentage: 100,
      });
    } finally {
      setLoadingStats(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-dark-bg text-dark-text p-6 min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  const selectedLab = labs.find(lab => lab._id === selectedLabId);

  // Format duration helper
  const formatDuration = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${Math.round(seconds)}s`;
    }
  };

  return (
    <div className="bg-dark-bg text-dark-text p-6 min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <ChartIcon className="w-8 h-8 text-sage-400" />
          <h1 className="heading-inter heading-inter-lg">AI Insights</h1>
        </div>

        {/* Lab Selection */}
        <div className="flex items-center gap-4 mt-4">
          <label className="text-gray-400">Shopfloor/Lab:</label>
          <select
            value={selectedLabId}
            onChange={(e) => setSelectedLabId(e.target.value)}
            className="bg-dark-panel border border-dark-border rounded px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-sage-500 focus:border-sage-500 min-w-[200px]"
            disabled={loading || labs.length === 0}
          >
            <option value="">
              {loading ? 'Loading labs...' : labs.length === 0 ? 'No labs available' : 'Select a lab...'}
            </option>
            {labs.map((lab) => (
              <option key={lab._id} value={lab._id}>
                {lab.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Insights Cards */}
      {selectedLabId && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Total Machines Card */}
          <div className="bg-dark-panel border border-dark-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-gray-400 text-sm">Total Machines</h3>
              <div className="w-12 h-12 bg-sage-500/20 rounded-lg flex items-center justify-center">
                <ShopfloorsIcon className="w-6 h-6 text-sage-400" />
              </div>
            </div>
            {loadingStats ? (
              <div className="text-gray-400">Loading...</div>
            ) : (
              <>
                <div className="text-4xl font-bold text-white mb-2">
                  {maintenanceStats?.totalMachines || machines.length || 0}
                </div>
                <div className="text-sm text-gray-500">
                  Active machines in {selectedLab?.name || 'selected lab'}
                </div>
              </>
            )}
          </div>

          {/* Scheduled Maintenance Card */}
          <div className="bg-dark-panel border border-dark-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-gray-400 text-sm">Scheduled Maintenance</h3>
              <div className="w-12 h-12 bg-sage-500/20 rounded-lg flex items-center justify-center">
                <CalendarIcon className="w-6 h-6 text-sage-400" />
              </div>
            </div>
            {loadingStats ? (
              <div className="text-gray-400">Loading...</div>
            ) : (
              <>
                <div className="text-4xl font-bold text-white mb-2">
                  {maintenanceStats?.scheduledMaintenanceCount || 0}
                </div>
                <div className="text-sm text-gray-500">
                  Work orders in the past month
                </div>
                {maintenanceStats && maintenanceStats.machinesWithMaintenance.length > 0 && (
                  <div className="mt-3 text-xs text-gray-400">
                    {maintenanceStats.machinesWithMaintenance.length} machine(s) had maintenance scheduled
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Downtime/Uptime Overview */}
      {selectedLabId && maintenanceStats && !loadingStats && (
        <div className="mt-6 bg-dark-panel border border-dark-border rounded-lg p-6">
          <h3 className="text-gray-300 mb-4">Performance (Last 7 Days)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="text-gray-400 text-sm mb-2">Total Downtime</div>
              <div className="text-3xl font-bold text-white mb-1">
                {maintenanceStats.downtimePercentage.toFixed(2)}%
              </div>
              <div className="text-sm text-gray-500">
                {formatDuration(maintenanceStats.totalDowntime)} of total time
              </div>
            </div>
            <div>
              <div className="text-gray-400 text-sm mb-2">Total Uptime</div>
              <div className="text-3xl font-bold text-sage-400 mb-1">
                {maintenanceStats.uptimePercentage.toFixed(2)}%
              </div>
              <div className="text-sm text-gray-500">
                {formatDuration(maintenanceStats.totalUptime)} of total time
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

