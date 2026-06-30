DO $$
DECLARE
  c1 UUID; c2 UUID; c3 UUID; c4 UUID; c5 UUID;
  e1 UUID; e2 UUID; e3 UUID; e4 UUID; e5 UUID;
  e6 UUID; e7 UUID; e8 UUID; e9 UUID; e10 UUID;
  e11 UUID; e12 UUID; e13 UUID; e14 UUID; e15 UUID;
  v1 UUID; v2 UUID; v3 UUID; v4 UUID; v5 UUID;
  ca1 UUID; ca2 UUID; ca3 UUID; ca4 UUID; ca5 UUID;
  ca6 UUID; ca7 UUID; ca8 UUID; ca9 UUID; ca10 UUID;
BEGIN
  TRUNCATE TABLE vacancy_interests, candidates, vacancies, supervision_visits, payments, contracts, employee_client_links, employees, clients RESTART IDENTITY CASCADE;

  -- Clientes
  INSERT INTO clients (id,name,cnpj,contact_name,contact_phone,contact_email,contract_start,positions_count,supervision_visits_per_month,requires_supervision) VALUES
    (gen_random_uuid(),'Hospital Sao Lucas','11.222.333/0001-01','Carlos Mendes','(11)99001-0001','carlos@saolucas.com','2026-04-01',3,2,true) RETURNING id INTO c1;
  INSERT INTO clients (id,name,cnpj,contact_name,contact_phone,contact_email,contract_start,positions_count,supervision_visits_per_month,requires_supervision) VALUES
    (gen_random_uuid(),'Clinica NutriVida','22.333.444/0001-02','Ana Souza','(11)99002-0002','ana@nutrivida.com','2026-04-01',2,1,true) RETURNING id INTO c2;
  INSERT INTO clients (id,name,cnpj,contact_name,contact_phone,contact_email,contract_start,positions_count,supervision_visits_per_month,requires_supervision) VALUES
    (gen_random_uuid(),'UBS Jardim Primavera','33.444.555/0001-03','Roberto Lima','(21)99003-0003','roberto@ubsjp.gov','2026-04-01',2,2,true) RETURNING id INTO c3;
  INSERT INTO clients (id,name,cnpj,contact_name,contact_phone,contact_email,contract_start,positions_count,supervision_visits_per_month,requires_supervision) VALUES
    (gen_random_uuid(),'Instituto Bem-Estar','44.555.666/0001-04','Mariana Costa','(31)99004-0004','mariana@bemestar.org','2026-04-01',4,1,true) RETURNING id INTO c4;
  INSERT INTO clients (id,name,cnpj,contact_name,contact_phone,contact_email,contract_start,positions_count,supervision_visits_per_month,requires_supervision) VALUES
    (gen_random_uuid(),'Academia FitLife','55.666.777/0001-05','Pedro Alves','(41)99005-0005','pedro@fitlife.com','2026-04-01',4,0,false) RETURNING id INTO c5;

  -- Colaboradores
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Fernanda Oliveira','111.111.111-01','(11)98001-0001','fernanda@email.com','CRN-3-12001','CRN-3','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e1;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Juliana Martins','222.222.222-02','(11)98002-0002','juliana@email.com','CRN-3-12002','CRN-3','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e2;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Rafael Santos','333.333.333-03','(11)98003-0003','rafael@email.com','CRN-3-12003','CRN-3','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e3;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Camila Ferreira','444.444.444-04','(11)98004-0004','camila@email.com','CRN-3-12004','CRN-3','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e4;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Lucas Rodrigues','555.555.555-05','(21)98005-0005','lucas@email.com','CRN-4-12005','CRN-4','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e5;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Amanda Pereira','666.666.666-06','(21)98006-0006','amanda@email.com','CRN-4-12006','CRN-4','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e6;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Thiago Costa','777.777.777-07','(31)98007-0007','thiago@email.com','CRN-6-12007','CRN-6','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e7;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Larissa Lima','888.888.888-08','(31)98008-0008','larissa@email.com','CRN-6-12008','CRN-6','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e8;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Bruno Almeida','999.999.999-09','(31)98009-0009','bruno@email.com','CRN-6-12009','CRN-6','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e9;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Isabela Souza','100.100.100-10','(31)98010-0010','isabela@email.com','CRN-6-12010','CRN-6','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e10;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Marcos Nunes','101.101.101-11','(31)98011-0011','marcos@email.com','CRN-6-12011','CRN-6','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e11;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Patricia Gomes','102.102.102-12','(41)98012-0012','patricia@email.com','CRN-8-12012','CRN-8','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e12;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Diego Carvalho','103.103.103-13','(41)98013-0013','diego@email.com','CRN-8-12013','CRN-8','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e13;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Vanessa Torres','104.104.104-14','(41)98014-0014','vanessa@email.com','CRN-8-12014','CRN-8','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e14;
  INSERT INTO employees (id,full_name,cpf,whatsapp,email,crn_number,crn_region,role,admission_date,status) VALUES (gen_random_uuid(),'Felipe Barbosa','105.105.105-15','(41)98015-0015','felipe@email.com','CRN-8-12015','CRN-8','Nutricionista','2026-04-01','Ativo') RETURNING id INTO e15;

  -- Vinculos
  INSERT INTO employee_client_links (employee_id,client_id,service_type,start_date,monthly_amount,cost_assistance) VALUES
    (e1,c1,'PJ','2026-04-01',4800,200),(e2,c1,'PJ','2026-04-01',5200,200),(e3,c1,'PJ','2026-04-01',5800,200),
    (e4,c2,'PJ','2026-04-01',4500,200),(e5,c2,'Consultoria','2026-04-01',4200,200),
    (e6,c3,'PJ','2026-04-01',4000,200),(e7,c3,'PJ','2026-04-01',4300,200),
    (e8,c4,'PJ','2026-04-01',4600,200),(e9,c4,'PJ','2026-04-01',4400,200),(e10,c4,'Consultoria','2026-04-01',4100,200),(e11,c4,'PJ','2026-04-01',4700,200),
    (e12,c5,'Consultoria','2026-04-01',4500,200),(e13,c5,'Consultoria','2026-04-01',5000,200),(e14,c5,'PJ','2026-04-01',3800,200),(e15,c5,'PJ','2026-04-01',3900,200);

  -- Pagamentos Abril
  INSERT INTO payments (description,amount,due_date,status,recurrence,category) VALUES
    ('Honorarios Fernanda Oliveira - Abr/2026',4800,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Juliana Martins - Abr/2026',5200,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Rafael Santos - Abr/2026',5800,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Camila Ferreira - Abr/2026',4500,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Lucas Rodrigues - Abr/2026',4200,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Amanda Pereira - Abr/2026',4000,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Thiago Costa - Abr/2026',4300,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Larissa Lima - Abr/2026',4600,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Bruno Almeida - Abr/2026',4400,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Isabela Souza - Abr/2026',4100,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Marcos Nunes - Abr/2026',4700,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Patricia Gomes - Abr/2026',4500,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Diego Carvalho - Abr/2026',5000,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Vanessa Torres - Abr/2026',3800,'2026-04-05','Pago','Mensal','Salário'),
    ('Honorarios Felipe Barbosa - Abr/2026',3900,'2026-04-05','Pago','Mensal','Salário');

  -- Pagamentos Maio
  INSERT INTO payments (description,amount,due_date,status,recurrence,category) VALUES
    ('Honorarios Fernanda Oliveira - Mai/2026',4800,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Juliana Martins - Mai/2026',5200,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Rafael Santos - Mai/2026',5800,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Camila Ferreira - Mai/2026',4500,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Lucas Rodrigues - Mai/2026',4200,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Amanda Pereira - Mai/2026',4000,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Thiago Costa - Mai/2026',4300,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Larissa Lima - Mai/2026',4600,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Bruno Almeida - Mai/2026',4400,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Isabela Souza - Mai/2026',4100,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Marcos Nunes - Mai/2026',4700,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Patricia Gomes - Mai/2026',4500,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Diego Carvalho - Mai/2026',5000,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Vanessa Torres - Mai/2026',3800,'2026-05-05','Pago','Mensal','Salário'),
    ('Honorarios Felipe Barbosa - Mai/2026',3900,'2026-05-05','Pago','Mensal','Salário');

  -- Pagamentos Junho (pendente)
  INSERT INTO payments (description,amount,due_date,status,recurrence,category) VALUES
    ('Honorarios Fernanda Oliveira - Jun/2026',4800,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Juliana Martins - Jun/2026',5200,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Rafael Santos - Jun/2026',5800,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Camila Ferreira - Jun/2026',4500,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Lucas Rodrigues - Jun/2026',4200,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Amanda Pereira - Jun/2026',4000,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Thiago Costa - Jun/2026',4300,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Larissa Lima - Jun/2026',4600,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Bruno Almeida - Jun/2026',4400,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Isabela Souza - Jun/2026',4100,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Marcos Nunes - Jun/2026',4700,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Patricia Gomes - Jun/2026',4500,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Diego Carvalho - Jun/2026',5000,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Vanessa Torres - Jun/2026',3800,'2026-06-05','Pendente','Mensal','Salário'),
    ('Honorarios Felipe Barbosa - Jun/2026',3900,'2026-06-05','Pendente','Mensal','Salário');

  -- Visitas de supervisao
  INSERT INTO supervision_visits (client_id,supervisor_name,visit_date,observations) VALUES
    (c1,'Coordenadora Time IN','2026-04-08','Visita mensal - tudo ok'),
    (c1,'Coordenadora Time IN','2026-04-22','Segunda visita - ajustes no cardapio'),
    (c2,'Coordenadora Time IN','2026-04-15','Visita NutriVida abril'),
    (c3,'Coordenadora Time IN','2026-04-10','Visita UBS - verificacao de protocolos'),
    (c3,'Coordenadora Time IN','2026-04-24','Segunda visita UBS abril'),
    (c4,'Coordenadora Time IN','2026-04-17','Visita Instituto Bem-Estar abril'),
    (c1,'Coordenadora Time IN','2026-05-07','Visita mensal maio'),
    (c1,'Coordenadora Time IN','2026-05-21','Segunda visita maio'),
    (c2,'Coordenadora Time IN','2026-05-14','Visita NutriVida maio'),
    (c3,'Coordenadora Time IN','2026-05-09','Visita UBS maio'),
    (c3,'Coordenadora Time IN','2026-05-23','Segunda visita UBS maio'),
    (c4,'Coordenadora Time IN','2026-05-16','Visita Instituto Bem-Estar maio');

  -- Vagas
  INSERT INTO vacancies (id,title,state,city,client_id,positions_count,requires_crn,requires_vehicle,status,opening_date) VALUES
    (gen_random_uuid(),'Nutricionista Hospitalar','SP','Sao Paulo',c1,2,true,false,'Aberta','2026-04-01') RETURNING id INTO v1;
  INSERT INTO vacancies (id,title,state,city,client_id,positions_count,requires_crn,requires_vehicle,status,opening_date) VALUES
    (gen_random_uuid(),'Nutricionista Clinica','SP','Campinas',c2,1,true,false,'Aberta','2026-04-10') RETURNING id INTO v2;
  INSERT INTO vacancies (id,title,state,city,client_id,positions_count,requires_crn,requires_vehicle,status,opening_date) VALUES
    (gen_random_uuid(),'Nutricionista UBS','RJ','Rio de Janeiro',c3,1,true,false,'Aberta','2026-04-15') RETURNING id INTO v3;
  INSERT INTO vacancies (id,title,state,city,client_id,positions_count,requires_crn,requires_vehicle,status,opening_date) VALUES
    (gen_random_uuid(),'Nutricionista Esportiva','MG','Belo Horizonte',c4,2,true,true,'Aberta','2026-05-01') RETURNING id INTO v4;
  INSERT INTO vacancies (id,title,state,city,client_id,positions_count,requires_crn,requires_vehicle,status,opening_date) VALUES
    (gen_random_uuid(),'Nutricionista Personal','PR','Curitiba',c5,3,false,false,'Aberta','2026-05-10') RETURNING id INTO v5;

  -- Candidatos
  INSERT INTO candidates (id,full_name,state,city,whatsapp,email,crn_number,crn_region,formation,pipeline_stage,has_vehicle,requires_travel) VALUES (gen_random_uuid(),'Marina Azevedo','SP','Sao Paulo','(11)97001-0001','marina@gmail.com','CRN-3-20001','CRN-3','Nutricao','Novo',false,false) RETURNING id INTO ca1;
  INSERT INTO candidates (id,full_name,state,city,whatsapp,email,crn_number,crn_region,formation,pipeline_stage,has_vehicle,requires_travel) VALUES (gen_random_uuid(),'Joao Pedro Silva','SP','Guarulhos','(11)97002-0002','joao@gmail.com','CRN-3-20002','CRN-3','Nutricao','Em contato',false,false) RETURNING id INTO ca2;
  INSERT INTO candidates (id,full_name,state,city,whatsapp,email,crn_number,crn_region,formation,pipeline_stage,has_vehicle,requires_travel) VALUES (gen_random_uuid(),'Beatriz Mendonca','SP','Campinas','(19)97003-0003','beatriz@gmail.com','CRN-3-20003','CRN-3','Nutricao','Entrevista Agendada',false,false) RETURNING id INTO ca3;
  INSERT INTO candidates (id,full_name,state,city,whatsapp,email,crn_number,crn_region,formation,pipeline_stage,has_vehicle,requires_travel) VALUES (gen_random_uuid(),'Andre Luis Costa','RJ','Rio de Janeiro','(21)97004-0004','andre@gmail.com','CRN-4-20004','CRN-4','Nutricao','Aprovado',false,true) RETURNING id INTO ca4;
  INSERT INTO candidates (id,full_name,state,city,whatsapp,email,crn_number,crn_region,formation,pipeline_stage,has_vehicle,requires_travel) VALUES (gen_random_uuid(),'Priscila Fonseca','MG','Belo Horizonte','(31)97005-0005','priscila@gmail.com','CRN-6-20005','CRN-6','Nutricao','Aprovado',true,true) RETURNING id INTO ca5;
  INSERT INTO candidates (id,full_name,state,city,whatsapp,email,crn_number,crn_region,formation,pipeline_stage,has_vehicle,requires_travel) VALUES (gen_random_uuid(),'Rodrigo Teixeira','PR','Curitiba','(41)97006-0006','rodrigo@gmail.com','CRN-8-20006','CRN-8','Nutricao','Em contato',false,false) RETURNING id INTO ca6;
  INSERT INTO candidates (id,full_name,state,city,whatsapp,email,crn_number,crn_region,formation,pipeline_stage,has_vehicle,requires_travel) VALUES (gen_random_uuid(),'Natalia Campos','SP','Sao Paulo','(11)97007-0007','natalia@gmail.com','CRN-3-20007','CRN-3','Nutricao','Novo',false,false) RETURNING id INTO ca7;
  INSERT INTO candidates (id,full_name,state,city,whatsapp,email,crn_number,crn_region,formation,pipeline_stage,has_vehicle,requires_travel) VALUES (gen_random_uuid(),'Gustavo Pires','SP','Sao Paulo','(11)97008-0008','gustavo@gmail.com','CRN-3-20008','CRN-3','Nutricao','Reprovado',false,false) RETURNING id INTO ca8;
  INSERT INTO candidates (id,full_name,state,city,whatsapp,email,crn_number,crn_region,formation,pipeline_stage,has_vehicle,requires_travel) VALUES (gen_random_uuid(),'Leticia Rocha','RJ','Niteroi','(21)97009-0009','leticia@gmail.com','CRN-4-20009','CRN-4','Nutricao','Em contato',false,false) RETURNING id INTO ca9;
  INSERT INTO candidates (id,full_name,state,city,whatsapp,email,crn_number,crn_region,formation,pipeline_stage,has_vehicle,requires_travel) VALUES (gen_random_uuid(),'Henrique Matos','MG','Uberlandia','(34)97010-0010','henrique@gmail.com','CRN-6-20010','CRN-6','Nutricao','Aprovado',true,true) RETURNING id INTO ca10;

  -- Interesses em vagas
  INSERT INTO vacancy_interests (vacancy_id,candidate_id,status,created_at) VALUES
    (v1,ca1,'Interessado','2026-04-02'),(v1,ca2,'Interessado','2026-04-03'),
    (v1,ca3,'Em contrato','2026-04-05'),(v2,ca3,'Interessado','2026-04-12'),
    (v3,ca4,'Contratado','2026-04-20'),(v4,ca5,'Em contrato','2026-05-03'),
    (v4,ca10,'Interessado','2026-05-05'),(v5,ca6,'Interessado','2026-05-12'),
    (v5,ca7,'Interessado','2026-05-13'),(v1,ca9,'Interessado','2026-05-20');

END $$;
