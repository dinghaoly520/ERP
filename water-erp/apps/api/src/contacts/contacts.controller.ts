import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateContactDto, UpdateContactDto } from './dto/contacts.dto';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post()
  @Roles('leader', 'admin', 'staff')
  create(@Body() dto: CreateContactDto) {
    return this.contactsService.create(dto);
  }

  @Get()
  @Roles('leader', 'admin', 'staff')
  findMany() {
    return this.contactsService.findMany();
  }

  @Get('by-name')
  @Roles('leader', 'admin', 'staff')
  findByName(@Query('name') name: string) {
    return this.contactsService.findByName(name);
  }

  @Get(':id')
  @Roles('leader', 'admin', 'staff')
  findOne(@Param('id') id: string) {
    return this.contactsService.findOne(id);
  }

  @Put(':id')
  @Roles('leader', 'admin', 'staff')
  update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contactsService.update(id, dto);
  }

  @Delete(':id')
  @Roles('leader', 'admin', 'staff')
  delete(@Param('id') id: string) {
    return this.contactsService.delete(id);
  }
}
