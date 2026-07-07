-- Inserir colaboradores da planilha Clientes.xlsx
-- Gerado automaticamente. Cole no SQL Editor do Supabase.

INSERT INTO employees (
  full_name, role, cpf, rg, birth_date, address_zip,
  crn_number, email, phone, whatsapp, employee_type, status, portal_pin, is_favorite
)
VALUES
  ('Ana Beatriz de Souza Amaral', 'Nutricionista fixa', '506.760.938-92', '39.345.411-3', '2002-01-21', '03591-020', NULL, 'anabeatrizamaral@fernandastinchi.com.br', '11 960946375', '11 960946375', 'Regular', 'Ativo', '554214', false),
  ('Ana Carolina Pereira Rodrigues de Araujo', 'Agente de Qualidade fixa', '434.308.328-45', '48.633.331-0', '1995-10-27', '08190-350', NULL, NULL, '11 984278342', '11 984278342', 'Regular', 'Ativo', '390689', false),
  ('Ana Carolina de Oliveira Pedroso', 'Nutricionista fixa', '317.749.288-33', '28.157.160-0', '1983-01-16', '5893180', '83079', NULL, '11 961650029', '11 961650029', 'Regular', 'Ativo', '338037', false),
  ('Anne Ericka Ramos Lenhaverde', 'Freelancer', NULL, '43.991.291-X', '1993-12-26', NULL, '73697', 'annelenhaverde@fernandastinchi.com.br', NULL, NULL, 'Regular', 'Ativo', '693975', true),
  ('Ariane Souza Machado', 'Agente de Qualidade', NULL, '48.033.011-6', '1991-08-24', NULL, '41800', 'arianemachado@fernandastinchi.com.br', NULL, NULL, 'Regular', 'Ativo', '497680', false),
  ('Beatriz Alessandra da Silva Cobra', 'Nutricionista fixa', '330.498.938-26', '37.261.815-7', '1996-07-14', '02842-010', '66655', 'beatrizcobra@fernandastinchi.com.br', '11 995725807', '11 995725807', 'Regular', 'Ativo', '706525', false),
  ('Diego Nunes Backaus', 'Temporário/Freelancer', '38793649827', '45.903.214-8', '1989-06-23', '09172-180', '40526', NULL, '11 981463912', '11 981463912', 'Regular', 'Ativo', '474599', false),
  ('Eudocia Cusnier', 'Nutricionista fixa', NULL, '38.929.807-4', '1983-05-01', NULL, '49350', 'eudociacusnier@fernandastinchi.com.br', NULL, NULL, 'Regular', 'Ativo', '388991', false),
  ('Francislene Galberto Marinho', 'Agente de Qualidade', NULL, '39.365.417-5', '1988-07-30', NULL, '52576', NULL, NULL, NULL, 'Regular', 'Ativo', '487288', false),
  ('Gabrielle Metka Rocha', 'Temporário', '073.842.569-92', '10.851.253-9', '1995-05-04', '83904-745', NULL, NULL, '42 988027554', '42 988027554', 'Regular', 'Ativo', '908988', false),
  ('Gabriel Alves Da Rosa', 'Agente de Qualidade', NULL, '59.394.892-0', '2001-05-31', NULL, '83819', 'gabrielrosa@fernandastinchi.com.br', NULL, NULL, 'Regular', 'Ativo', '779227', false),
  ('Giovana de Jesus Oliveira', 'Coordenadora de Qualidade', NULL, '39.580.222-2', '2002-12-18', NULL, '81.850/P', 'giovanaoliveira@fernandastinchi.com.br', NULL, NULL, 'Regular', 'Ativo', '183941', false),
  ('Graziele Bassi de Andrade', 'Temporário/Freelancer', NULL, '44.652.465-7', '1989-01-10', NULL, '66337', 'grazielebassi@fernandastinchi.com.br', NULL, NULL, 'Regular', 'Ativo', '702959', false),
  ('Isabelli Poliani Pessoa de Araujo', 'Temporário', '100.605.439-14', '13.203.327-7', '1997-06-09', '83506-040', NULL, NULL, '41 998082057', '41 998082057', 'Regular', 'Ativo', '249923', false),
  ('Janaina de Souza Loureiro dos Santos', 'Freelancer', '011.648.957-02', '09.474.195-0', '1971-12-31', '21011-570', '25105057', NULL, '21 998996028', '21 998996028', 'Regular', 'Ativo', '741555', true),
  ('Jennifer Pereira Lima', 'Nutricionista fixa', '463.925.128-96', '52.953.523-3', '2002-07-23', '08260-340', NULL, 'jenniferpereira@fernandastinchi.com.br', '11 985586243', '11 985586243', 'Regular', 'Ativo', '853102', false),
  ('Joana D''Arc', 'Freelancer', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Regular', 'Ativo', '668583', true),
  ('Josineide da Silva Bernardes', 'Técnica em nutrição fixa', '491.511.318-38', '59.046.645-8', '2001-05-11', '08744-160', NULL, 'josibernardes@fernandastinchi.com.br', '11 997850178', '11 997850178', 'Regular', 'Ativo', '640342', false),
  ('Juliany Cristina Silva Cunha', 'Agente de Qualidade fixa', '430.750.548-44', '49.170.814-2', '1993-04-08', '02842-260', NULL, 'julianycunha@fernandastinchi.com.br', '11 997058162', '11 997058162', 'Regular', 'Ativo', '458460', false),
  ('Lucas Lage dos Santos', 'Temporário', '434.896.118-29', '39.191.435-2', '1995-05-25', '09130-010', NULL, NULL, '11 958033770', '11 958033770', 'Regular', 'Ativo', '650376', false),
  ('Luciana de Oliveira Machado', 'Nutricionista fixa', '098.892.027-19', '126520378', '1982-05-10', '23570510', NULL, 'lucianamachado@fernandastinchi.com.br', '21 975691656', '21 975691656', 'Regular', 'Ativo', '273761', false),
  ('Luciene Ferreira de Araújo', 'Freelancer', NULL, '36.620.136-0', '1983-01-14', NULL, '40159', NULL, NULL, NULL, 'Regular', 'Ativo', '948578', true),
  ('Maria Fernanda Brandão Santos', 'Gerente', '427.067.818-66', '388455512', '1997-12-23', '03932-050', '62782', 'mariafernanda@fernandastinchi.com.br', '11 958081350', '11 958081350', 'Regular', 'Ativo', '154695', false),
  ('Mirella Caiado Bomfim', 'Nutricionista fixa', '296.668.928-55', '35.934.466-5', '1982-01-25', '04104-021', '488818', 'mirellabomfim@fernandastinchi.com.br', '11 953486712', '11 953486712', 'Regular', 'Ativo', '931605', false),
  ('Nathalia Aparecida de Jesus Santos', 'Nutricionista fixa', '442.774.898-85', '38.226.711-x', '1996-12-08', '04857-043', NULL, 'nathaliasantos@fernandastinchi.com.br', '11 962122380', '11 962122380', 'Regular', 'Ativo', '161278', false),
  ('Ornella Monique Pereira Ferri', 'Temporário', '063.208.159-73', '6320815973', '1988-07-23', '87308-150', NULL, NULL, '44 988148921', '44 988148921', 'Regular', 'Ativo', '803080', false),
  ('Paloma Remígio Schmidt', NULL, NULL, '50.177.449-X', '1996-08-31', NULL, '84771', 'palomaschmidt@fernandastinchi.com.br', NULL, NULL, 'Regular', 'Ativo', '423745', false),
  ('Silvia Irene Graf', 'Freelancer', '066.129.308-45', '3.929.645-3', '1961-03-25', NULL, '1634', 'silviagraf@fernandastinchi.com.br', '11 983829282', '11 983829282', 'Regular', 'Ativo', '542547', true),
  ('Talita Maggi Paramo', 'Nutricionista fixa', '319.207.968-19', '32.397.794-7', '1984-10-04', '07130-410', '24069', 'talitamaggi@fernandastinchi.com.br', '11 973971837', '11 973971837', 'Regular', 'Ativo', '904055', false),
  ('Vânia Milaneze', 'Agente de Qualidade fixa', '217.305.738-35', '34.488.515-X', '1980-06-15', '08190-430', '40812', 'vaniamilaneze@fernandastinchi.com.br', '11 975474396', '11 975474396', 'Regular', 'Ativo', '240910', false),
  ('Hellen Santana Vieira', NULL, '071.702.555-10', '1455172847', '1999-10-16', '41280-370', NULL, NULL, NULL, NULL, 'Regular', 'Ativo', '269899', false)
;

-- Total: 31 colaboradores
-- Favoritos (⭐): Anne Ericka, Janaina, Joana D'Arc, Luciene, Silvia
