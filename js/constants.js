// js/constants.js — shared SAMO org structure (ฝ่ายอุปนายก + sub-departments).
// Single source of truth used by both the admin terminal and the student dashboard,
// so a rename happens in one place. (The admin create/edit <select>s and SUB_DEPT_OPTIONS
// still live in admin-page.js / the HTML — those are input widgets, not display labels.)

export const DEPARTMENTS = {
    1: 'บริหารองค์กร', 2: 'ดิจิทัลและสื่อสารองค์กร', 3: 'กิจการภายใน',
    4: 'กิจการภายนอก', 5: 'กิจการมหาวิทยาลัย', 6: 'วิชาการ',
    7: 'ยุทธศาสตร์และพัฒนาองค์กร', 8: 'คุณภาพชีวิตและสิ่งแวดล้อม',
    9: 'เวชนิทัศน์', 10: 'รังสีเทคนิค',
};

export const SUBDEPARTMENTS = { 1: 'โครงการ', 2: 'ชุมนุม', 3: 'จิตอาสา', 4: '7 คณะ' };

// Which ฝ่ายอุปนายก each sub-department hangs off. Mirrors SUB_DEPT_OPTIONS in
// admin-page.js (the input widget) — keep the two in sync. Used by admin-scope.js
// to resolve a sub-department grant back to the department it must be filed under.
export const SUBDEPT_PARENT = { 1: 3, 2: 3, 3: 5, 4: 5 };
