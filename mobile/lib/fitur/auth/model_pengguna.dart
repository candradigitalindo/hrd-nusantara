/// Pengguna yang sedang login. Bentuknya mengikuti GET /auth/me.
class Pengguna {
  const Pengguna({
    required this.id,
    required this.nik,
    required this.nama,
    required this.email,
    required this.peran,
    required this.status,
    this.departemen,
    this.jabatan,
    this.telepon,
    this.alamat,
  });

  final String id;
  final String nik;
  final String nama;
  final String email;
  final String peran;
  final String status;
  final String? departemen;
  final String? jabatan;
  final String? telepon;
  final String? alamat;

  bool get hr => peran == 'SUPER_ADMIN' || peran == 'HR_ADMIN';
  bool get manajemen => hr || peran == 'MANAGER';

  factory Pengguna.dariJson(Map<String, dynamic> j) => Pengguna(
        id: j['id'] as String,
        nik: (j['nik'] ?? '') as String,
        nama: (j['name'] ?? '') as String,
        email: (j['email'] ?? '') as String,
        peran: (j['role'] ?? 'EMPLOYEE') as String,
        status: (j['status'] ?? 'active') as String,
        departemen: (j['department'] as Map?)?['name'] as String?,
        jabatan: (j['position'] as Map?)?['name'] as String?,
        telepon: j['phoneNumber'] as String?,
        alamat: j['address'] as String?,
      );

  Map<String, dynamic> keJson() => {
        'id': id,
        'nik': nik,
        'name': nama,
        'email': email,
        'role': peran,
        'status': status,
        'department': departemen == null ? null : {'name': departemen},
        'position': jabatan == null ? null : {'name': jabatan},
        'phoneNumber': telepon,
        'address': alamat,
      };
}
