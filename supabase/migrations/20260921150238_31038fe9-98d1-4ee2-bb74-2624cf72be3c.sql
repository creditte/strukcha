DELETE FROM public.xero_connections WHERE tenant_id::text IN (
  '11111111-2222-3333-4444-555555555555',
  '8f771d8d-1420-48f1-acd0-5dbeb43ae4bc',
  '12bea2a7-cbd0-4697-8c4e-59fe07d24cc0',
  'ba9e6a87-ba0a-4c9f-a49f-3ab703dadf1c',
  '871e331d-a438-4854-a8f7-611631111849',
  'bad9d2c7-3472-4509-9914-5aa6c623b4a3',
  '05d5c0d4-df20-49b8-bffd-b51bc8484812',
  'e705071e-97e0-4023-a60d-fda951f1be8a',
  '1719ba8c-8656-4343-9480-c2dbaa9c9d58',
  '408170b0-898d-4d24-bcdc-7fe30dd267db',
  '182dc50a-6d93-4c14-bf42-560064a9f4da'
);

DELETE FROM public.tenants WHERE id IN (
  '11111111-2222-3333-4444-555555555555',
  '8f771d8d-1420-48f1-acd0-5dbeb43ae4bc',
  '12bea2a7-cbd0-4697-8c4e-59fe07d24cc0',
  'ba9e6a87-ba0a-4c9f-a49f-3ab703dadf1c',
  '871e331d-a438-4854-a8f7-611631111849',
  'bad9d2c7-3472-4509-9914-5aa6c623b4a3',
  '05d5c0d4-df20-49b8-bffd-b51bc8484812',
  'e705071e-97e0-4023-a60d-fda951f1be8a',
  '1719ba8c-8656-4343-9480-c2dbaa9c9d58',
  '408170b0-898d-4d24-bcdc-7fe30dd267db',
  '182dc50a-6d93-4c14-bf42-560064a9f4da'
);