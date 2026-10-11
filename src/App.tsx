import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Clock3,
  Globe2,
  Home,
  Languages,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Package,
  Phone,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Hammer,
  UserRound,
  Users,
  Wallet,
  Wrench,
  Zap,
} from 'lucide-react';

type Role = 'customer' | 'worker' | 'seller' | 'admin';
type View = 'overview' | 'services' | 'parts' | 'orders' | 'profile';
type Language = 'en' | 'te' | 'hi' | 'ta' | 'bn';
type Booking = { id: number; customer: string; service: string; distance: string; status: 'Pending' | 'Accepted' | 'On the Way' | 'Completed' };

const languageNames: Record<Language, string> = { en: 'English', te: 'తెలుగు', hi: 'हिन्दी', ta: 'தமிழ்', bn: 'বাংলা' };
const translations: Record<Language, Record<string, string>> = {
  en: { login: 'Welcome back!', continue: 'Login to continue', phone: 'Mobile number', password: 'Password / OTP', loginButton: 'Login', customer: 'Customer', worker: 'Worker', seller: 'Seller', guest: 'Guest', language: 'Language', search: 'Search workers by name or service', book: 'Book Now', tracking: 'Booking Details & Service Tracking', onWay: 'On the Way' },
  te: { login: 'స్వాగతం!', continue: 'కొనసాగడానికి లాగిన్ చేయండి', phone: 'మొబైల్ నంబర్', password: 'పాస్‌వర్డ్ / OTP', loginButton: 'లాగిన్', customer: 'కస్టమర్', worker: 'వర్కర్', seller: 'విక్రేత', guest: 'అతిథి', language: 'భాష', search: 'పేరు లేదా సేవతో వర్కర్లను వెతకండి', book: 'బుక్ చేయండి', tracking: 'బుకింగ్ వివరాలు & సేవ ట్రాకింగ్', onWay: 'దారిలో ఉన్నారు' },
  hi: { login: 'वापसी पर स्वागत है!', continue: 'जारी रखने के लिए लॉगिन करें', phone: 'मोबाइल नंबर', password: 'पासवर्ड / OTP', loginButton: 'लॉगिन', customer: 'ग्राहक', worker: 'वर्कर', seller: 'विक्रेता', guest: 'अतिथि', language: 'भाषा', search: 'नाम या सेवा से वर्कर खोजें', book: 'बुक करें', tracking: 'बुकिंग विवरण और सेवा ट्रैकिंग', onWay: 'रास्ते में' },
  ta: { login: 'மீண்டும் வரவேற்கிறோம்!', continue: 'தொடர உள்நுழையவும்', phone: 'மொபைல் எண்', password: 'கடவுச்சொல் / OTP', loginButton: 'உள்நுழை', customer: 'வாடிக்கையாளர்', worker: 'பணியாளர்', seller: 'விற்பனையாளர்', guest: 'விருந்தினர்', language: 'மொழி', search: 'பெயர் அல்லது சேவை மூலம் தேடுங்கள்', book: 'முன்பதிவு', tracking: 'முன்பதிவு விவரங்கள் மற்றும் சேவை கண்காணிப்பு', onWay: 'வழியில்' },
  bn: { login: 'আবার স্বাগতম!', continue: 'চালিয়ে যেতে লগইন করুন', phone: 'মোবাইল নম্বর', password: 'পাসওয়ার্ড / OTP', loginButton: 'লগইন', customer: 'গ্রাহক', worker: 'কর্মী', seller: 'বিক্রেতা', guest: 'অতিথি', language: 'ভাষা', search: 'নাম বা সেবা দিয়ে কর্মী খুঁজুন', book: 'এখনই বুক করুন', tracking: 'বুকিং বিবরণ এবং সেবা ট্র্যাকিং', onWay: 'পথে আছে' },
};
function text(language: Language, key: string) { return translations[language][key] ?? translations.en[key] ?? key; }

function BrandMark() {
  return <svg className="brand-mark" viewBox="0 0 64 64" role="img" aria-label="Nearby Worker logo"><defs><linearGradient id="brand-pin" x1="8" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse"><stop stopColor="#2de6bb" /><stop offset="0.52" stopColor="#10c99b" /><stop offset="1" stopColor="#08a8d8" /></linearGradient><linearGradient id="brand-tool" x1="21" y1="18" x2="46" y2="47" gradientUnits="userSpaceOnUse"><stop stopColor="#8affda" /><stop offset="1" stopColor="#27bdf0" /></linearGradient></defs><path d="M32 3.5C17.8 3.5 7 14.1 7 27.2c0 16.7 25 33.3 25 33.3s25-16.6 25-33.3C57 14.1 46.2 3.5 32 3.5Z" fill="url(#brand-pin)" stroke="#b7ffea" strokeWidth="1.5" /><circle cx="32" cy="27" r="16.5" fill="#063b66" stroke="#8affda" strokeWidth="1.5" /><path d="M41.8 17.2a8.7 8.7 0 0 0-7.3 11.6L22.2 41.1a4.4 4.4 0 1 0 6.2 6.2l13-12.9a8.7 8.7 0 0 0 10.4-10.7l-6.1 5.8-5.3-2.1-2.1-5.2 5.8-6.1a8.7 8.7 0 0 0-2.3-.9Z" fill="url(#brand-tool)" /><circle cx="25.3" cy="44.1" r="2.2" fill="#063b66" /></svg>;
}

type Worker = {
  name: string;
  specialty: string;
  rating: string;
  distance: string;
  color: string;
  initials: string;
};

const workers: Worker[] = [
  { name: 'Ramesh Kumar', specialty: 'Plumber', rating: '4.9', distance: '2.1 km', color: '#e7f7f2', initials: 'RK' },
  { name: 'Suresh Babu', specialty: 'Electrician', rating: '4.8', distance: '1.8 km', color: '#eaf4ff', initials: 'SB' },
  { name: 'Arun Kumar', specialty: 'AC Technician', rating: '4.9', distance: '2.5 km', color: '#fff2dd', initials: 'AK' },
  { name: 'Priya Singh', specialty: 'Home Repair', rating: '4.7', distance: '3.2 km', color: '#eef0ff', initials: 'PS' },
];

const categories = [
  { name: 'Plumbing', icon: Wrench, color: 'bg-sky-50 text-sky-600' },
  { name: 'Electrical', icon: Zap, color: 'bg-amber-50 text-amber-600' },
  { name: 'AC Repair', icon: Sparkles, color: 'bg-cyan-50 text-cyan-600' },
  { name: 'Mechanic', icon: Hammer, color: 'bg-rose-50 text-rose-600' },
  { name: 'Home Repairs', icon: Home, color: 'bg-emerald-50 text-emerald-600' },
];

const roleLabels: Record<Role, string> = {
  customer: 'Customer',
  worker: 'Worker',
  seller: 'Seller',
  admin: 'Admin',
};

function App() {
  const [role, setRole] = useState<Role>('customer');
  const [view, setView] = useState<View>('overview');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [language, setLanguage] = useState<Language>('en');
  const [bookings, setBookings] = useState<Booking[]>([
    { id: 1, customer: 'Shrilivas', service: 'Plumbing', distance: '2.4 km', status: 'Pending' },
    { id: 2, customer: 'Lakshmi', service: 'Electrical', distance: '3.2 km', status: 'Accepted' },
  ]);

  const filteredWorkers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workers;
    return workers.filter((worker) => `${worker.name} ${worker.specialty}`.toLowerCase().includes(query));
  }, [search]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  };

  const selectRole = (nextRole: Role) => {
    setRole(nextRole);
    setView('overview');
    setMobileNavOpen(false);
  };

  const createBooking = (service: string, customer = 'Ramesh Kumar') => {
    const booking: Booking = { id: Date.now(), customer, service, distance: '2.1 km', status: 'Pending' };
    setBookings((current) => [booking, ...current]);
    showNotice(`${service} request sent to nearby workers.`);
  };

  if (!loggedIn) return <LoginScreen role={role === 'admin' ? 'customer' : role} language={language} setLanguage={setLanguage} onRoleChange={selectRole} onLogin={(nextRole) => { setRole(nextRole); setLoggedIn(true); }} />;

  return (
    <div className="min-h-screen bg-[#f4f8fb] text-[#153653]">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#073b67] text-white shadow-lg shadow-slate-900/10">
        <div className="mx-auto flex h-[76px] max-w-[1440px] items-center gap-5 px-5 lg:px-8">
          <button className="mr-1 rounded-xl p-2 hover:bg-white/10 lg:hidden" onClick={() => setMobileNavOpen(!mobileNavOpen)} aria-label="Open navigation"><Menu size={22} /></button>
          <button onClick={() => { setRole('customer'); setView('overview'); }} className="flex shrink-0 items-center gap-2 text-left">
            <BrandMark />
            <div><div className="text-[22px] font-extrabold leading-none tracking-tight">Nearby <span className="text-[#16c99b]">Worker</span></div><div className="mt-1 text-[9px] font-medium tracking-wide text-slate-300">Your Home. Our Priority.</div></div>
          </button>
          <nav className="ml-auto hidden items-center gap-8 text-sm font-semibold lg:flex">
            <button onClick={() => { setRole('customer'); setView('services'); }} className="hover:text-[#50e4bb]">Find Nearby Workers</button>
            <button onClick={() => { setRole('customer'); setView('orders'); }} className="hover:text-[#50e4bb]">Book Services</button>
            <button onClick={() => { setRole('seller'); setView('parts'); }} className="hover:text-[#50e4bb]">Buy / Sell Spare Parts</button>
          </nav>
          <div className="hidden items-center gap-5 text-xs text-slate-300 xl:flex"><span>Fast <b className="mx-2 text-[#15c89b]">•</b> Reliable <b className="mx-2 text-[#15c89b]">•</b> Affordable</span><span className="h-7 w-px bg-white/20" /><Globe2 size={16} /><select value={language} onChange={(event) => setLanguage(event.target.value as Language)} aria-label={text(language, 'language')} className="bg-transparent text-xs font-semibold text-white outline-none"><option className="text-slate-900" value="en">EN</option><option className="text-slate-900" value="te">తెలుగు</option><option className="text-slate-900" value="hi">हिन्दी</option><option className="text-slate-900" value="ta">தமிழ்</option><option className="text-slate-900" value="bn">বাংলা</option></select><ChevronDown size={13} /></div>
          <button onClick={() => setLoggedIn(!loggedIn)} className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-2 py-1.5 text-left transition hover:bg-white/20"><div className="avatar avatar-sm">RK</div><span className="hidden text-xs font-semibold sm:block">Ramesh</span><ChevronDown size={13} /></button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px]">
        <aside className={`${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-[76px] left-0 z-20 w-[250px] border-r border-slate-200 bg-[#063b66] p-4 text-white transition-transform lg:sticky lg:top-[76px] lg:h-[calc(100vh-76px)] lg:translate-x-0`}>
          <div className="mb-6 rounded-2xl bg-white/10 p-3"><div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-200"><UserRound size={15} /> Switch workspace</div><div className="grid grid-cols-2 gap-1.5">{(['customer', 'worker', 'seller', 'admin'] as Role[]).map((item) => <button key={item} onClick={() => selectRole(item)} className={`rounded-lg px-2 py-2 text-[11px] font-bold transition ${role === item ? 'bg-[#11bd8d] text-white shadow-md' : 'text-slate-300 hover:bg-white/10'}`}>{roleLabels[item]}</button>)}</div></div>
          <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">Main menu</div>
          <div className="space-y-1">{getNavItems(role).map((item) => <button key={item.label} onClick={() => { setView(item.view); setMobileNavOpen(false); }} className={`sidebar-item ${view === item.view ? 'sidebar-item-active' : ''}`}><item.icon size={17} />{item.label}{item.badge && <span className="ml-auto rounded-full bg-[#f9b44b] px-1.5 py-0.5 text-[9px] text-white">{item.badge}</span>}</button>)}</div>
          <div className="mt-auto hidden border-t border-white/10 pt-4 lg:block"><button className="sidebar-item text-slate-300"><Settings size={17} />Settings</button><button className="sidebar-item text-slate-300"><LogOut size={17} />Logout</button></div>
        </aside>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><p className="mb-1 text-xs font-semibold text-[#0db48a]">{roleLabels[role]} workspace</p><h1 className="text-2xl font-extrabold tracking-tight text-[#123753] sm:text-[28px]">{getGreeting(role, view)}</h1><p className="mt-1 text-sm text-slate-500">Everything you need, right at your fingertips.</p></div><div className="flex items-center gap-2"><button onClick={() => showNotice('Notifications are all caught up.')} className="relative rounded-xl border border-slate-200 bg-white p-3 text-slate-500 shadow-sm transition hover:border-[#12b98b] hover:text-[#0cae84]"><Bell size={18} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#f36c58]" /></button><button onClick={() => showNotice('Help center opened.')} className="rounded-xl border border-slate-200 bg-white p-3 text-slate-500 shadow-sm transition hover:border-[#12b98b] hover:text-[#0cae84]"><CircleHelp size={18} /></button></div></div>

          {role === 'customer' && <CustomerView view={view} search={search} setSearch={setSearch} workers={filteredWorkers} onAction={showNotice} onBook={createBooking} language={language} />}
          {role === 'worker' && <WorkerView onAction={showNotice} bookings={bookings} language={language} />}
          {role === 'seller' && <SellerView onAction={showNotice} />}
          {role === 'admin' && <AdminView />}
        </main>
      </div>
      {notice && <div className="toast"><Check size={16} />{notice}</div>}
      <footer className="border-t border-slate-200 bg-white px-5 py-5 text-center text-xs text-slate-400 lg:pl-[250px]">© 2026 Nearby Worker <span className="mx-2 text-[#12b98b]">•</span> Repair <span className="mx-2 text-[#12b98b]">•</span> Buy <span className="mx-2 text-[#12b98b]">•</span> Sell <span className="mx-2 text-[#12b98b]">•</span> Grow Together</footer>
    </div>
  );
}

function getGreeting(role: Role, view: View) {
  if (view === 'services') return 'Find the right worker';
  if (view === 'parts') return 'Spare parts marketplace';
  if (view === 'orders') return role === 'customer' ? 'Your bookings' : 'Recent orders';
  if (view === 'profile') return 'Your profile';
  return role === 'customer' ? 'Good morning, Ramesh!' : role === 'worker' ? 'Welcome back, Ramesh!' : role === 'seller' ? 'Seller dashboard' : 'Admin overview';
}

function getNavItems(role: Role) {
  if (role === 'worker') return [{ label: 'Dashboard', icon: LayoutDashboard, view: 'overview' as View }, { label: 'Service Requests', icon: ClipboardList, view: 'services' as View, badge: '3' }, { label: 'My Bookings', icon: CalendarDays, view: 'orders' as View }, { label: 'Earnings', icon: Wallet, view: 'orders' as View }, { label: 'Availability', icon: Clock3, view: 'profile' as View }, { label: 'Profile', icon: UserRound, view: 'profile' as View }];
  if (role === 'seller') return [{ label: 'Dashboard', icon: LayoutDashboard, view: 'overview' as View }, { label: 'Add Product', icon: Plus, view: 'parts' as View }, { label: 'My Products', icon: Package, view: 'parts' as View }, { label: 'Orders', icon: ClipboardList, view: 'orders' as View }, { label: 'Sales Report', icon: Wallet, view: 'orders' as View }, { label: 'Profile', icon: UserRound, view: 'profile' as View }];
  if (role === 'admin') return [{ label: 'Dashboard', icon: LayoutDashboard, view: 'overview' as View }, { label: 'Users', icon: Users, view: 'services' as View }, { label: 'Workers', icon: BriefcaseBusiness, view: 'services' as View }, { label: 'Sellers', icon: Store, view: 'parts' as View }, { label: 'Bookings', icon: CalendarDays, view: 'orders' as View }, { label: 'Reports', icon: Wallet, view: 'orders' as View }];
  return [{ label: 'Home', icon: Home, view: 'overview' as View }, { label: 'Book a Service', icon: Wrench, view: 'services' as View }, { label: 'Spare Parts', icon: Package, view: 'parts' as View }, { label: 'My Bookings', icon: CalendarDays, view: 'orders' as View, badge: '2' }, { label: 'Orders', icon: ShoppingBag, view: 'orders' as View }, { label: 'Wallet', icon: Wallet, view: 'profile' as View }, { label: 'Profile', icon: UserRound, view: 'profile' as View }];
}

function CustomerView({ view, search, setSearch, workers, onAction, onBook, language }: { view: View; search: string; setSearch: (value: string) => void; workers: Worker[]; onAction: (message: string) => void; onBook: (service: string) => void; language: Language }) {
  return <div className="space-y-6">
    {view === 'overview' && <><section className="hero-banner"><div className="relative z-10 max-w-[55%]"><span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#a8f8df]"><Sparkles size={12} /> Trusted local help</span><h2 className="text-2xl font-extrabold leading-tight sm:text-3xl">Find the best<br /><span className="text-[#4de1b4]">repair workers</span> near you.</h2><p className="mt-2 text-xs leading-5 text-slate-200 sm:text-sm">Skilled professionals. Quality service.<br />One simple booking.</p><button onClick={() => onAction('Choose a service to get started.')} className="mt-5 rounded-lg bg-[#13c794] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-950/20 transition hover:bg-[#0eae81]">Book Now <ArrowRight className="ml-1 inline" size={14} /></button></div><div className="hero-illustration"><div className="sun" /><div className="house house-back" /><div className="house house-front" /><div className="worker-figure"><div className="helmet" /><div className="body" /><div className="tool-arm" /></div></div></section><SectionTitle title="What do you need help with?" action="View all" onAction={() => onAction('Showing all service categories.')} /><div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{categories.map(({ name, icon: Icon, color }) => <button key={name} onClick={() => onAction(`${name} services selected.`)} className="category-card"><span className={`category-icon ${color}`}><Icon size={22} /></span><span>{name}</span></button>)}</div><SectionTitle title="Nearby workers" action="View all" onAction={() => onAction('Showing all nearby workers.')} /><WorkerGrid workers={workers} onAction={onAction} onBook={onBook} bookLabel={text(language, 'book')} /></>}
    {view === 'services' && <><SearchBar value={search} onChange={setSearch} placeholder={text(language, 'search')} /><SectionTitle title={`${workers.length} workers near you`} action="Sort by rating" onAction={() => onAction('Workers sorted by rating.')} /><WorkerGrid workers={workers} onAction={onAction} onBook={onBook} bookLabel={text(language, 'book')} empty={search.length > 0} /></>}
    {view === 'orders' && <OrdersPanel onAction={onAction} language={language} />}
    {view === 'parts' && <PartsPanel onAction={onAction} />}
    {view === 'profile' && <ProfilePanel onAction={onAction} />}
  </div>;
}

function SectionTitle({ title, action, onAction }: { title: string; action: string; onAction: () => void }) { return <div className="flex items-center justify-between"><h2 className="section-title">{title}</h2><button onClick={onAction} className="text-xs font-bold text-[#0aaf84] hover:underline">{action} <ArrowRight className="ml-1 inline" size={13} /></button></div>; }
function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><Search size={18} className="text-slate-400" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" /></label>; }
function WorkerGrid({ workers: workerList, onAction, onBook, bookLabel = 'Book Now', empty = false }: { workers: Worker[]; onAction: (message: string) => void; onBook?: (service: string) => void; bookLabel?: string; empty?: boolean }) { return workerList.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{workerList.map((worker) => <div className="worker-card" key={worker.name}><div className="flex items-start justify-between"><div className="worker-photo" style={{ backgroundColor: worker.color }}>{worker.initials}</div><button className="rounded-full p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500"><span className="sr-only">Save worker</span>♡</button></div><h3 className="mt-3 text-sm font-extrabold text-[#173956]">{worker.name}</h3><p className="mt-0.5 text-xs text-slate-500">{worker.specialty}</p><div className="mt-3 flex items-center justify-between text-[11px]"><span className="flex items-center gap-1 font-bold text-amber-500"><Star size={13} fill="currentColor" />{worker.rating}</span><span className="flex items-center gap-1 text-slate-400"><MapPin size={12} />{worker.distance}</span></div><button onClick={() => onBook ? onBook(worker.specialty) : onAction(`Booking request sent to ${worker.name}.`)} className="mt-4 w-full rounded-lg bg-[#0eb98b] py-2 text-xs font-bold text-white transition hover:bg-[#099b76]">{bookLabel}</button></div>)}</div> : <div className="empty-state">{empty ? 'No workers match that search.' : 'No workers available right now.'}</div>; }

function StatCards({ items }: { items: { label: string; value: string; icon: typeof Wallet; color: string }[] }) { return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map(({ label, value, icon: Icon, color }) => <div className="stat-card" key={label}><span className={`stat-icon ${color}`}><Icon size={18} /></span><div><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-extrabold text-[#133852]">{value}</p></div></div>)}</div>; }
function WorkerView({ onAction, bookings, language }: { onAction: (message: string) => void; bookings: Booking[]; language: Language }) { return <div className="space-y-6"><StatCards items={[{ label: 'Total bookings', value: '12', icon: CalendarDays, color: 'bg-sky-50 text-sky-600' }, { label: 'Completed jobs', value: '8', icon: Check, color: 'bg-emerald-50 text-emerald-600' }, { label: 'Pending requests', value: '3', icon: Clock3, color: 'bg-amber-50 text-amber-600' }, { label: 'Total earnings', value: '₹8,450', icon: Wallet, color: 'bg-rose-50 text-rose-600' }]} /><div className="panel"><div className="mb-5 flex items-center justify-between"><div><h2 className="section-title">Recent service requests</h2><p className="mt-1 text-xs text-slate-500">Review and respond to nearby customers.</p></div><button onClick={() => onAction('All service requests opened.')} className="text-xs font-bold text-[#0aaf84]">View all</button></div><RequestTable onAction={onAction} bookings={bookings} language={language} /></div></div>; }
function RequestTable({ onAction, bookings, language }: { onAction: (message: string) => void; bookings: Booking[]; language: Language }) { const rows = bookings; return <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Customer</th><th>Service</th><th>Location</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="font-bold text-[#173956]">{row.customer}</td><td>{row.service}</td><td>{row.distance}</td><td><span className={`status ${row.status === 'Pending' ? 'status-pending' : row.status === 'Completed' ? 'status-done' : 'status-active'}`}>{row.status}</span></td><td><button onClick={() => onAction(`${row.customer}'s request opened.`)} className="rounded-md border border-[#b4d7e8] px-3 py-1 text-[11px] font-bold text-[#16719b] hover:bg-sky-50">{row.status === 'Pending' ? text(language, 'onWay') : 'View'}</button></td></tr>)}</tbody></table></div>; }
function SellerView({ onAction }: { onAction: (message: string) => void }) { return <div className="space-y-6"><StatCards items={[{ label: 'Total products', value: '48', icon: Package, color: 'bg-sky-50 text-sky-600' }, { label: 'Total orders', value: '32', icon: ShoppingBag, color: 'bg-emerald-50 text-emerald-600' }, { label: 'Total sales', value: '₹18,620', icon: Wallet, color: 'bg-rose-50 text-rose-600' }, { label: 'Store rating', value: '4.8', icon: Star, color: 'bg-amber-50 text-amber-600' }]} /><div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]"><div className="panel"><div className="mb-4 flex items-center justify-between"><h2 className="section-title">Recent orders</h2><button onClick={() => onAction('All orders opened.')} className="text-xs font-bold text-[#0aaf84]">View all</button></div><table className="data-table"><thead><tr><th>Customer</th><th>Product</th><th>Amount</th><th>Status</th></tr></thead><tbody>{[['Ravi', 'Brake Pad', '₹1,200', 'Pending'], ['Suresh', 'Spark Plug', '₹850', 'Shipped'], ['Anita', 'Oil Filter', '₹650', 'Delivered'], ['Kumar', 'Air Filter', '₹780', 'Processing']].map(([name, product, amount, status]) => <tr key={name}><td className="font-bold text-[#173956]">{name}</td><td>{product}</td><td>{amount}</td><td><span className={`status ${status === 'Pending' ? 'status-pending' : 'status-done'}`}>{status}</span></td></tr>)}</tbody></table></div><div className="panel"><h2 className="section-title">Sales overview</h2><div className="mt-6 flex h-40 items-end gap-3 border-b border-l border-slate-200 px-3 pb-0 pt-5">{[38, 55, 44, 68, 57, 82, 74, 92].map((height, index) => <div key={index} className="group flex flex-1 flex-col items-center gap-2"><div className="w-full rounded-t-md bg-[#16bd8d] transition group-hover:bg-[#078db2]" style={{ height: `${height}%` }} /><span className="text-[9px] text-slate-400">{['M', 'T', 'W', 'T', 'F', 'S', 'S', 'M'][index]}</span></div>)}</div></div></div><button onClick={() => onAction('Add product form opened.')} className="rounded-xl bg-[#0eb98b] px-5 py-3 text-xs font-bold text-white shadow-lg shadow-emerald-700/10 transition hover:bg-[#099b76]"><Plus className="mr-2 inline" size={15} />Add a new product</button></div>; }
function AdminView() { return <div className="space-y-6"><StatCards items={[{ label: 'Total users', value: '1,248', icon: Users, color: 'bg-sky-50 text-sky-600' }, { label: 'Active workers', value: '356', icon: BriefcaseBusiness, color: 'bg-emerald-50 text-emerald-600' }, { label: 'Sellers', value: '142', icon: Store, color: 'bg-amber-50 text-amber-600' }, { label: 'Bookings', value: '892', icon: CalendarDays, color: 'bg-rose-50 text-rose-600' }]} /><div className="grid gap-5 lg:grid-cols-2"><div className="panel"><h2 className="section-title">Booking overview</h2><div className="mt-5 h-44"><svg viewBox="0 0 500 170" className="h-full w-full" preserveAspectRatio="none"><path d="M0 145 C40 130, 50 140, 80 117 S125 129, 155 103 S190 110, 220 78 S270 105, 300 90 S335 45, 370 66 S420 29, 500 43 L500 170 L0 170Z" fill="#e4f8f2" /><path d="M0 145 C40 130, 50 140, 80 117 S125 129, 155 103 S190 110, 220 78 S270 105, 300 90 S335 45, 370 66 S420 29, 500 43" fill="none" stroke="#0eb98b" strokeWidth="3" /></svg></div></div><div className="panel"><h2 className="section-title">Service categories</h2><div className="mt-6 flex items-center justify-center gap-8"><div className="donut-chart" /><div className="space-y-2 text-xs text-slate-600"><p><i className="legend bg-[#0eb98b]" />Plumbing 32%</p><p><i className="legend bg-[#f9b44b]" />Electrical 20%</p><p><i className="legend bg-[#168ec1]" />AC Repair 25%</p><p><i className="legend bg-[#f06c58]" />Other 23%</p></div></div></div></div></div>; }
function OrdersPanel({ onAction, language }: { onAction: (message: string) => void; language: Language }) { return <div className="space-y-5"><TrackingPanel onAction={onAction} language={language} /><div className="panel"><div className="mb-5 flex items-center justify-between"><div><h2 className="section-title">Bookings & orders</h2><p className="mt-1 text-xs text-slate-500">Track all of your recent activity in one place.</p></div><button onClick={() => onAction('New booking started.')} className="rounded-lg bg-[#0eb98b] px-3 py-2 text-xs font-bold text-white"><Plus className="mr-1 inline" size={14} />New booking</button></div><div className="space-y-3">{[['Plumbing service', 'Ramesh Kumar', 'Tomorrow, 10:00 AM', 'Confirmed'], ['Brake Pad · 1 item', 'AutoCare Store', 'Delivered yesterday', 'Delivered'], ['Electrical repair', 'Suresh Babu', '12 Oct, 2:30 PM', 'Pending']].map(([title, person, date, status]) => <div className="order-row" key={title}><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-[#0eb98b]"><ClipboardList size={19} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-[#173956]">{title}</p><p className="mt-1 text-xs text-slate-500">{person} <span className="mx-1">·</span> {date}</p></div><span className="status status-active">{status}</span><button onClick={() => onAction(`${title} details opened.`)} className="hidden rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500 sm:block">View</button></div>)}</div></div></div>; }
function PartsPanel({ onAction }: { onAction: (message: string) => void }) { return <><section className="market-banner"><div><p className="text-xs font-bold uppercase tracking-widest text-[#a9f8df]">Trusted sellers · Fast delivery</p><h2 className="mt-2 text-2xl font-extrabold">Genuine spare parts<br />for every repair.</h2><button onClick={() => onAction('Marketplace opened.')} className="mt-4 rounded-lg bg-[#0eb98b] px-4 py-2 text-xs font-bold">Shop now <ArrowRight className="ml-1 inline" size={14} /></button></div><div className="parts-art"><div /><div /><div /><div /></div></section><SectionTitle title="Featured products" action="View all" onAction={() => onAction('All spare parts opened.')} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Brake Pad', '₹1,200', 'BP'], ['Spark Plug', '₹450', 'SP'], ['Air Filter', '₹760', 'AF'], ['Oil Filter', '₹650', 'OF']].map(([name, price, initials]) => <div className="product-card" key={name}><div className="product-image">{initials}</div><h3 className="mt-3 text-sm font-extrabold text-[#173956]">{name}</h3><p className="mt-1 text-sm font-bold text-[#0cae84]">{price}</p><button onClick={() => onAction(`${name} added to cart.`)} className="mt-3 w-full rounded-lg border border-[#a8dccd] py-2 text-xs font-bold text-[#0aaf84] hover:bg-emerald-50"><ShoppingCart className="mr-1 inline" size={14} />Add to cart</button></div>)}</div></>; }
function ProfilePanel({ onAction }: { onAction: (message: string) => void }) { return <div className="panel max-w-2xl"><div className="flex items-center gap-4 border-b border-slate-100 pb-5"><div className="avatar avatar-lg">RK</div><div><h2 className="text-lg font-extrabold text-[#173956]">Ramesh Kumar</h2><p className="mt-1 text-xs text-slate-500">ramesh@example.com</p></div><button onClick={() => onAction('Profile editing enabled.')} className="ml-auto rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-500">Edit profile</button></div><div className="mt-5 space-y-4"><label className="field-label">Full name<input className="field-input" defaultValue="Ramesh Kumar" /></label><label className="field-label">Mobile number<input className="field-input" defaultValue="+91 98765 43210" /></label><label className="field-label">Location<div className="field-input flex items-center gap-2"><MapPin size={15} className="text-[#0eb98b]" />Hyderabad, Telangana</div></label></div><button onClick={() => onAction('Profile changes saved.')} className="mt-6 rounded-lg bg-[#0eb98b] px-5 py-2.5 text-xs font-bold text-white">Save changes</button></div>; }

function LoginScreen({ role, language, setLanguage, onRoleChange, onLogin }: { role: Role; language: Language; setLanguage: (language: Language) => void; onRoleChange: (role: Role) => void; onLogin: (role: Role) => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!phone.trim() || !password.trim()) {
      setError('Enter your mobile number and password or OTP to continue.');
      return;
    }
    setError('');
    onLogin(role);
  };

  return <div className="flex min-h-screen items-center justify-center bg-[#eef6fa] p-4 sm:p-8"><div className="login-shell grid w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl shadow-sky-950/15 lg:grid-cols-[.9fr_1.1fr]"><section className="login-visual relative hidden overflow-hidden bg-[#063b66] p-10 text-white lg:block"><div className="relative z-10"><div className="flex items-center gap-2"><BrandMark /><div><div className="text-xl font-extrabold">Nearby <span className="text-[#16c99b]">Worker</span></div><p className="text-[10px] text-slate-300">Your Home. Our Priority.</p></div></div><p className="mt-20 text-sm font-semibold text-[#91e8ce]">Repair services · Spare parts · Buy & Sell</p><h1 className="mt-3 max-w-sm text-4xl font-extrabold leading-tight">Help is always<br /><span className="text-[#16c99b]">nearby.</span></h1><p className="mt-4 max-w-xs text-sm leading-6 text-slate-300">Connect with trusted local professionals for every repair, service, and spare part.</p><div className="login-house"><div className="login-roof" /><div className="login-window" /><div className="login-door" /><div className="login-person"><div className="head" /><div className="torso" /></div></div></div><div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full border-[30px] border-[#11bd8d]/20" /></section><section className="p-6 sm:p-10"><div className="mb-8 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.16em] text-[#0eb98b]">{text(language, 'guest')} access</p><h2 className="mt-2 text-2xl font-extrabold text-[#173956]">{text(language, 'login')}</h2><p className="mt-1 text-sm text-slate-500">{text(language, 'continue')}</p></div><label className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-500"><Languages size={14} className="text-[#0eb98b]" /><select value={language} onChange={(event) => setLanguage(event.target.value as Language)} className="max-w-[92px] bg-transparent font-semibold outline-none">{(Object.keys(languageNames) as Language[]).map((item) => <option key={item} value={item}>{languageNames[item]}</option>)}</select></label></div><div className="mb-6 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-1">{(['customer', 'worker', 'seller'] as Role[]).map((item) => <button key={item} onClick={() => onRoleChange(item)} className={`rounded-lg px-2 py-2.5 text-xs font-bold transition ${role === item ? 'bg-white text-[#0ba77d] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{text(language, item)}</button>)}</div><form onSubmit={submit} className="space-y-5"><label className="field-label">{text(language, 'phone')}<div className="field-with-icon"><Phone size={16} /><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91  Enter your mobile number" /></div></label><label className="field-label">{text(language, 'password')}<div className="field-with-icon"><MessageCircle size={16} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password or OTP" /></div></label><div className="flex items-center justify-between text-[11px]"><label className="flex items-center gap-2 text-slate-500"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="accent-[#0eb98b]" />Remember me</label><button type="button" className="font-bold text-[#0aaf84]">Forgot Password?</button></div>{error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{error}</p>}<button type="submit" className="w-full rounded-lg bg-[#0eb98b] py-3 text-sm font-bold text-white shadow-lg shadow-emerald-700/15 transition hover:bg-[#099b76]">{text(language, 'loginButton')}</button></form><div className="my-6 flex items-center gap-3 text-[11px] text-slate-400"><span className="h-px flex-1 bg-slate-200" />OR<span className="h-px flex-1 bg-slate-200" /></div><button type="button" onClick={() => onLogin(role)} className="w-full rounded-lg border border-[#8bc9df] py-3 text-xs font-bold text-[#16719b] hover:bg-sky-50">Login with OTP</button><p className="mt-6 text-center text-xs text-slate-500">New user? <button type="button" className="font-bold text-[#0aaf84]">Create Account</button></p></section></div></div>;
}

function TrackingPanel({ onAction, language }: { onAction: (message: string) => void; language: Language }) {
  const [moving, setMoving] = useState(false);
  const [progress, setProgress] = useState(28);
  useEffect(() => {
    if (!moving) return;
    const timer = window.setInterval(() => setProgress((current) => current >= 96 ? 96 : current + 4), 650);
    return () => window.clearInterval(timer);
  }, [moving]);
  const startTracking = () => {
    setMoving(true);
    onAction('Ramesh Kumar is on the way. Live tracking started.');
  };
  return <div className="panel overflow-hidden"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="section-title">{text(language, 'tracking')}</h2>{moving && <span className="live-pill"><span />LIVE</span>}</div><p className="mt-1 text-xs text-slate-500">Plumbing service · Ramesh Kumar · 2.1 km away</p></div><button onClick={moving ? () => setMoving(false) : startTracking} className={`rounded-lg px-3 py-2 text-xs font-bold ${moving ? 'border border-rose-200 text-rose-600' : 'bg-[#0eb98b] text-white'}`}>{moving ? 'Pause tracking' : text(language, 'onWay')}</button></div><div className="tracking-map"><div className="map-road map-road-one" /><div className="map-road map-road-two" /><div className="map-road map-road-three" /><div className="map-label map-label-home"><Home size={13} />Your location</div><div className="map-label map-label-worker" style={{ left: `${progress}%` }}><div className={`tracking-worker ${moving ? 'tracking-worker-moving' : ''}`}><Wrench size={16} /></div><span>Ramesh</span></div><div className="map-pin map-pin-home"><MapPin size={24} fill="currentColor" /></div><div className="map-route" style={{ width: `${progress}%` }} /></div><div className="mt-4 grid grid-cols-3 gap-3 text-center"><div><p className="text-lg font-extrabold text-[#173956]">{moving ? Math.max(1, Math.ceil((100 - progress) / 25)) : '4'} min</p><p className="text-[10px] text-slate-400">Estimated arrival</p></div><div><p className="text-lg font-extrabold text-[#173956]">{moving ? 'On the way' : 'Accepted'}</p><p className="text-[10px] text-slate-400">Booking status</p></div><div><p className="text-lg font-extrabold text-[#173956]">₹500</p><p className="text-[10px] text-slate-400">Service estimate</p></div></div></div>;
}

export default App;
