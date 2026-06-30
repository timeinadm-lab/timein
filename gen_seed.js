const crypto = require('crypto');
const fs = require('fs');

const clients = [
  { id: 'c1000001-0000-0000-0000-000000000001', name: 'Hospital São Lucas', cnpj: '12.345.678/0001-01', address: 'Av. Paulista, 1500 - São Paulo/SP', contact_name: 'Dr. Roberto Almeida', contact_phone: '(11) 3456-7890', contact_email: 'roberto@saolucas.com.br', visits: 4, positions: 3, obs: 'Consultoria nutricional. Turnos alternados.' },
  { id: 'c2000002-0000-0000-0000-000000000002', name: 'Restaurante BonGout', cnpj: '23.456.789/0001-02', address: 'Rua Augusta, 500 - São Paulo/SP', contact_name: 'Marina Costa', contact_phone: '(11) 94567-8901', contact_email: 'marina@bongout.com.br', visits: 2, positions: 2, obs: 'Restaurante comercial. Escala 6x1.' },
  { id: 'c3000003-0000-0000-0000-000000000003', name: 'SENAI Centro São Paulo', cnpj: '34.567.890/0001-03', address: 'Rua Monsenhor Andrade, 298 - São Paulo/SP', contact_name: 'Paulo Ferreira', contact_phone: '(11) 2345-6789', contact_email: 'paulo@senai.br', visits: 1, positions: 2, obs: 'Escola tecnica. Escala 5x2.' },
  { id: 'c4000004-0000-0000-0000-000000000004', name: 'Sabor Brasil Industria', cnpj: '45.678.901/0001-04', address: 'Rod. Anhanguera km 47 - Campinas/SP', contact_name: 'Claudia Menezes', contact_phone: '(19) 3456-0001', contact_email: 'claudia@saborbrasil.ind.br', visits: 2, positions: 4, obs: 'Cozinha industrial 2000 refeicoes/dia.' },
  { id: 'c5000005-0000-0000-0000-000000000005', name: 'Vitalfood Refeicoes', cnpj: '56.789.012/0001-05', address: 'Av. das Nacoes Unidas, 2300 - Sao Paulo/SP', contact_name: 'Andre Lima', contact_phone: '(11) 99876-5432', contact_email: 'andre@vitalfood.com.br', visits: 2, positions: 4, obs: 'Refeicoes coletivas. 3 unidades em SP.' },
];

const empData = [
  { id: 'e1000001-0000-0000-0000-000000000001', name: 'Danielle Ruiz Rodrigues', cpf: '111.222.333-01', phone: '11964117887', email: 'daniruiz1893@gmail.com', state: 'SP', city: 'Sao Paulo', pin: '241853', client_id: clients[0].id, salary: 4800, service_type: 'CLT' },
  { id: 'e2000002-0000-0000-0000-000000000002', name: 'Karine dos Santos Alves', cpf: '222.333.444-02', phone: '11973520063', email: 'karine.santos1alves@gmail.com', state: 'SP', city: 'Sao Paulo', pin: '156742', client_id: clients[0].id, salary: 5200, service_type: 'CLT' },
  { id: 'e3000003-0000-0000-0000-000000000003', name: 'Alessandra Vieira de Mattos', cpf: '333.444.555-03', phone: '11983325123', email: 'alessandra.vmattos@gmail.com', state: 'SP', city: 'Sao Paulo', pin: '389421', client_id: clients[0].id, salary: 5800, service_type: 'PJ' },
  { id: 'e4000004-0000-0000-0000-000000000004', name: 'Emanuelle Marcelino Vieira', cpf: '444.555.666-04', phone: '11991376355', email: 'emanuellemarcelino@icloud.com', state: 'SP', city: 'Suzano', pin: '472916', client_id: clients[1].id, salary: 4500, service_type: 'CLT' },
  { id: 'e5000005-0000-0000-0000-000000000005', name: 'Luana Furlan', cpf: '555.666.777-05', phone: '11939019474', email: 'luafur@hotmail.com', state: 'SP', city: 'Sao Paulo', pin: '518237', client_id: clients[1].id, salary: 4200, service_type: 'CLT' },
  { id: 'e6000006-0000-0000-0000-000000000006', name: 'Elaine Farias Barbosa Santos', cpf: '666.777.888-06', phone: '11978783053', email: 'lansantos.farias@gmail.com', state: 'SP', city: 'Sao Paulo', pin: '629348', client_id: clients[2].id, salary: 4000, service_type: 'CLT' },
  { id: 'e7000007-0000-0000-0000-000000000007', name: 'Silvio de Camargo Hemmel', cpf: '777.888.999-07', phone: '11961251010', email: 'sylvio.hemmel@gmail.com', state: 'SP', city: 'Sao Paulo', pin: '731854', client_id: clients[2].id, salary: 4300, service_type: 'CLT' },
  { id: 'e8000008-0000-0000-0000-000000000008', name: 'Micaela Oliveira', cpf: '888.999.000-08', phone: '11981122969', email: 'nutricionista.micaela12@outlook.com', state: 'SP', city: 'Sao Paulo', pin: '842965', client_id: clients[3].id, salary: 4600, service_type: 'CLT' },
  { id: 'e9000009-0000-0000-0000-000000000009', name: 'Michelle Vieira Reis', cpf: '999.000.111-09', phone: '31996098420', email: 'michellereis07@gmail.com', state: 'MG', city: 'Belo Horizonte', pin: '953071', client_id: clients[3].id, salary: 4400, service_type: 'CLT' },
  { id: 'e1000010-0000-0000-0000-000000000010', name: 'Franciele Figueiro Lima', cpf: '100.111.222-10', phone: '62993227235', email: 'francielenutri65@gmail.com', state: 'SP', city: 'Cesario Lange', pin: '164827', client_id: clients[3].id, salary: 4100, service_type: 'CLT' },
  { id: 'e1000011-0000-0000-0000-000000000011', name: 'Maisa Cantanhede Costa', cpf: '111.222.333-11', phone: '79996919181', email: 'maisaccosta31@gmail.com', state: 'SE', city: 'Aracaju', pin: '275938', client_id: clients[3].id, salary: 4700, service_type: 'PJ' },
  { id: 'e1000012-0000-0000-0000-000000000012', name: 'Melila Rosario de Oliveira', cpf: '222.333.444-12', phone: '27996053765', email: 'melrdo2@gmail.com', state: 'ES', city: 'Vitoria', pin: '386049', client_id: clients[4].id, salary: 4500, service_type: 'CLT' },
  { id: 'e1000013-0000-0000-0000-000000000013', name: 'Erika da Silva Rosa', cpf: '333.444.555-13', phone: '31980252077', email: 'rosaerika.nutri@gmail.com', state: 'MG', city: 'Uberlandia', pin: '497160', client_id: clients[4].id, salary: 5000, service_type: 'Freelancer' },
  { id: 'e1000014-0000-0000-0000-000000000014', name: 'Natalia Martins Silvi', cpf: '444.555.666-14', phone: '11951798238', email: 'natalia.silvi@outlook.com', state: 'SP', city: 'Sao Paulo', pin: '508271', client_id: clients[4].id, salary: 3800, service_type: 'CLT' },
  { id: 'e1000015-0000-0000-0000-000000000015', name: 'Iago Moreira Santos', cpf: '555.666.777-15', phone: '11964410134', email: 'iagomoreira499@gmail.com', state: 'SP', city: 'Sao Paulo', pin: '619382', client_id: clients[4].id, salary: 3900, service_type: 'CLT' },
];

const candidates = [
  { name: 'Danubia Xavier de Oliveira', phone: '62982801327', email: 'danubiaxo@gmail.com', state: 'GO', city: 'Anicuns', crn: '15669-1', exp: '1 a 3 anos', area: 'UAN', travel: true, relocation: false, vehicle: true, stage: 'Banco' },
  { name: 'Janaina de Souza Loureiro', phone: '21998996028', email: 'nutricionista.janaina.rj@gmail.com', state: 'RJ', city: 'Rio de Janeiro', crn: 'CRN4-25105', exp: '1 a 3 anos', area: 'UAN', travel: true, relocation: false, vehicle: true, stage: 'Contato Feito' },
  { name: 'Yara Moreira Pandufo', phone: '11974007696', email: 'ym.moreira@hotmail.com', state: 'SP', city: 'Aruja', crn: 'CRN3-45095', exp: '3 a 5 anos', area: 'UAN', travel: false, relocation: false, vehicle: true, stage: 'Em Avaliacao' },
  { name: 'Ana Paula Santos de Moraes', phone: '21982409549', email: 'paulasantos1032@gmail.com', state: 'RJ', city: 'Rio de Janeiro', crn: 'CRN4', exp: '3 a 5 anos', area: 'UAN', travel: false, relocation: false, vehicle: false, stage: 'Entrevista Agendada' },
  { name: 'Marly Duarte dos Santos', phone: '91982000059', email: 'marlyduarte.nutri@gmail.com', state: 'PA', city: 'Belem', crn: 'CRN7-17384', exp: '1 a 3 anos', area: 'UAN', travel: true, relocation: true, vehicle: false, stage: 'Banco' },
  { name: 'Giovanna Leide Leandro', phone: '12981786497', email: 'giovannalleandro@gmail.com', state: 'SP', city: 'Jacarei', crn: 'CRN3-84163', exp: '1 a 3 anos', area: 'UAN', travel: true, relocation: true, vehicle: false, stage: 'Aprovado' },
  { name: 'Natalia Ferreira de Souza', phone: '12992094316', email: 'nfscrisostomo@gmail.com', state: 'SP', city: 'Sao Jose dos Campos', crn: 'CRN3-85046', exp: '1 a 3 anos', area: 'UAN', travel: true, relocation: true, vehicle: true, stage: 'Em Processo de Contratacao' },
  { name: 'Marilia Fabia Alves Moreira', phone: '84994462477', email: 'mariliafabia30@gmail.com', state: 'RN', city: 'Natal', crn: 'CRN6-45208', exp: '1 a 3 anos', area: 'UAN', travel: true, relocation: true, vehicle: true, stage: 'Banco' },
  { name: 'Carla Denise de Souza', phone: '11947195865', email: 'carladenise74@gmail.com', state: 'SP', city: 'Suzano', crn: 'CRN3-56455', exp: '1 a 3 anos', area: 'Nutricao Clinica', travel: true, relocation: false, vehicle: true, stage: 'Contato Feito' },
  { name: 'Jaquelime da Silva Olimpio', phone: '11992900886', email: 'jaquelinesilvaolimpio22@gmail.com', state: 'SP', city: 'Carapicuiba', crn: 'CRN3-T123597', exp: '1 a 3 anos', area: 'UAN', travel: true, relocation: false, vehicle: false, stage: 'Banco' },
];

const vacancies = [
  { id: 'v1000001-0000-0000-0000-000000000001', client_id: clients[0].id, title: 'Nutricionista UAN - Hospital Sao Lucas', city: 'Sao Paulo', state: 'SP', min_exp: 'Mais de 3 anos', status: 'Fechada' },
  { id: 'v2000002-0000-0000-0000-000000000002', client_id: clients[1].id, title: 'Nutricionista UAN - Restaurante BonGout', city: 'Sao Paulo', state: 'SP', min_exp: 'Mais de 1 ano', status: 'Fechada' },
  { id: 'v3000003-0000-0000-0000-000000000003', client_id: clients[3].id, title: 'Nutricionista UAN - Sabor Brasil Industria', city: 'Campinas', state: 'SP', min_exp: 'Mais de 1 ano', status: 'Aberta' },
  { id: 'v4000004-0000-0000-0000-000000000004', client_id: clients[4].id, title: 'Nutricionista Fixo - Vitalfood Refeicoes', city: 'Sao Paulo', state: 'SP', min_exp: 'Mais de 1 ano', status: 'Aberta' },
  { id: 'v5000005-0000-0000-0000-000000000005', client_id: clients[2].id, title: 'Nutricionista UAN - SENAI Centro SP', city: 'Sao Paulo', state: 'SP', min_exp: 'Qualquer', status: 'Fechada' },
];

function workDays(year, month) {
  const days = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    const dow = d.getDay();
    if (dow > 0 && dow < 6) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

const allDays = [...workDays(2026, 4), ...workDays(2026, 5)];

let sql = '-- Time IN: Seed simulacao 2 meses (Abril-Maio 2026)\n\n';

// CLIENTS
sql += 'INSERT INTO clients (id, name, cnpj, address, contact_name, contact_phone, contact_email, contract_start, contract_end, positions_count, supervision_visits_per_month, observations) VALUES\n';
sql += clients.map(c =>
  `('${c.id}', '${c.name}', '${c.cnpj}', '${c.address}', '${c.contact_name}', '${c.contact_phone}', '${c.contact_email}', '2024-01-15', '2027-01-14', ${c.positions}, ${c.visits}, '${c.obs}')`
).join(',\n') + ';\n\n';

// EMPLOYEES
sql += 'INSERT INTO employees (id, full_name, cpf, whatsapp, email, role, status, portal_pin) VALUES\n';
sql += empData.map(e =>
  `('${e.id}', '${e.name}', '${e.cpf}', '${e.phone}', '${e.email}', 'Nutricionista UAN', 'Ativo', '${e.pin}')`
).join(',\n') + ';\n\n';

// EMPLOYEE_CLIENT_LINKS
sql += 'INSERT INTO employee_client_links (id, employee_id, client_id, service_type, start_date, monthly_amount, cost_assistance) VALUES\n';
sql += empData.map((e, i) => {
  const lId = `l${String(i+1).padStart(7,'0')}-0000-0000-0000-${String(i+1).padStart(12,'0')}`;
  return `('${lId}', '${e.id}', '${e.client_id}', '${e.service_type}', '2026-04-01', ${e.salary}, 200)`;
}).join(',\n') + ';\n\n';

// CONTRACTS
sql += 'INSERT INTO contracts (id, employee_id, client_name, status, start_date, salary, requires_supervision, supervision_visits_per_month) VALUES\n';
sql += empData.map((e, i) => {
  const cId = `ct${String(i+1).padStart(6,'0')}-0000-0000-0000-${String(i+1).padStart(12,'0')}`;
  const clientName = clients.find(c => c.id === e.client_id).name;
  return `('${cId}', '${e.id}', '${clientName}', 'Ativo', '2026-04-01', ${e.salary}, false, 0)`;
}).join(',\n') + ';\n\n';

// PAYMENTS
const payMonths = [
  { month: '2026-04', status: 'Pago', paid_at: '2026-05-05' },
  { month: '2026-05', status: 'Pago', paid_at: '2026-06-05' },
  { month: '2026-06', status: 'Pendente', paid_at: null },
];
const payRows = [];
empData.forEach((e, ei) => {
  payMonths.forEach((pm, mi) => {
    const pId = `p${String(ei * 3 + mi + 1).padStart(6,'0')}-0000-0000-0000-${String(ei * 3 + mi + 1).padStart(12,'0')}`;
    const wg = e.service_type === 'Freelancer' ? 'temporario' : 'fixo_plantao';
    const paid = pm.paid_at ? `'${pm.paid_at}'` : 'null';
    payRows.push(`('${pId}', '${e.id}', '${pm.month}', ${e.salary}, '${pm.status}', '${wg}', ${paid})`);
  });
});
sql += 'INSERT INTO payments (id, employee_id, reference_month, amount, status, worker_group, paid_at) VALUES\n';
sql += payRows.join(',\n') + ';\n\n';

// NUTRITIONIST_VISITS
const visitRows = [];
empData.forEach((e, ei) => {
  for (let d = ei % 4; d < allDays.length; d += 3) {
    const day = allDays[d];
    const yyyy = day.getFullYear();
    const mm = String(day.getMonth() + 1).padStart(2, '0');
    const dd = String(day.getDate()).padStart(2, '0');
    const vId = `nv${String(visitRows.length + 1).padStart(5,'0')}-0000-0000-0000-${String(visitRows.length + 1).padStart(12,'0')}`;
    visitRows.push(`('${vId}', '${e.id}', '${e.client_id}', '${yyyy}-${mm}-${dd}T08:00:00', '${yyyy}-${mm}-${dd}T17:00:00', 'Visita registrada')`);
  }
});
sql += 'INSERT INTO nutritionist_visits (id, employee_id, client_id, check_in, check_out, notes) VALUES\n';
sql += visitRows.join(',\n') + ';\n\n';

// VACANCIES
sql += 'INSERT INTO vacancies (id, title, state, city, status, positions_count, client_id, min_experience, opening_date, deadline, formation, requires_crn, requires_vehicle, requires_travel, requires_relocation) VALUES\n';
sql += vacancies.map(v =>
  `('${v.id}', '${v.title}', '${v.state}', '${v.city}', '${v.status}', 2, '${v.client_id}', '${v.min_exp}', '2026-02-01', '2026-04-30', 'Nutricionista', true, false, false, false)`
).join(',\n') + ';\n\n';

// CANDIDATES
sql += 'INSERT INTO candidates (id, full_name, whatsapp, email, state, city, crn_number, formation, experience_time, experience_area, requires_travel, requires_relocation, has_vehicle, pipeline_stage) VALUES\n';
sql += candidates.map((c, i) => {
  const cId = `ca${String(i+1).padStart(6,'0')}-0000-0000-0000-${String(i+1).padStart(12,'0')}`;
  return `('${cId}', '${c.name}', '${c.phone}', '${c.email}', '${c.state}', '${c.city}', '${c.crn}', 'Nutricionista', '${c.exp}', '${c.area}', ${c.travel}, ${c.relocation}, ${c.vehicle}, '${c.stage}')`;
}).join(',\n') + ';\n\n';

// VACANCY INTERESTS
const interests = [
  { cIdx: 0, vIdx: 2 }, { cIdx: 1, vIdx: 3 }, { cIdx: 3, vIdx: 2 },
  { cIdx: 5, vIdx: 3 }, { cIdx: 6, vIdx: 3 }, { cIdx: 7, vIdx: 2 },
  { cIdx: 8, vIdx: 4 },
];
sql += 'INSERT INTO vacancy_interests (id, candidate_id, vacancy_id, status, created_at) VALUES\n';
sql += interests.map((intr, i) => {
  const iId = `vi${String(i+1).padStart(6,'0')}-0000-0000-0000-${String(i+1).padStart(12,'0')}`;
  const cId = `ca${String(intr.cIdx+1).padStart(6,'0')}-0000-0000-0000-${String(intr.cIdx+1).padStart(12,'0')}`;
  return `('${iId}', '${cId}', '${vacancies[intr.vIdx].id}', 'Em avaliacao', '2026-03-15')`;
}).join(',\n') + ';\n\n';

fs.writeFileSync('seed_simulacao.sql', sql);
console.log('Gerado! Total linhas:', sql.split('\n').length);
console.log('Visits:', visitRows.length, '| Payments:', payRows.length);
